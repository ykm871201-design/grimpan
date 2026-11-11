// 로컬 테스트용 "가짜 Supabase" 서버
// ─ 실제 schema.sql 을 PGlite(WebAssembly PostgreSQL)에 적용하고, 앱이 사용하는
//   Auth / PostgREST / Storage / Realtime(웹소켓) 엔드포인트를 최소한으로 흉내 냅니다.
// ─ 모든 요청은 요청자의 JWT 로 'authenticated' 역할 + RLS 를 적용해 실행되므로
//   권한·격리 로직은 실제 Supabase 와 동일한 SQL 로 검증됩니다.
// ─ 실제 서비스용이 아닙니다. (서명 검증 없음, 단일 프로세스, 메모리 저장)
// 실행: node tests/e2e/mock-supabase.mjs   (기본 포트 54321)
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { PGlite } from '@electric-sql/pglite';

const PORT = Number(process.env.MOCK_PORT || 54321);
const here = path.dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(path.join(here, '..', '..', 'supabase', 'schema.sql'), 'utf8');

const STUBS = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, is_anonymous boolean default false, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  owner uuid default auth.uid(), created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant usage on schema auth, storage, public to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
`;
const NOTIFY = `
create function public._mock_notify() returns trigger language plpgsql as $$
begin
  perform pg_notify('mock_changes', json_build_object('table', TG_TABLE_NAME, 'type', TG_OP,
    'record', case when TG_OP = 'DELETE' then null else row_to_json(NEW) end,
    'old_record', case when TG_OP = 'INSERT' then null else json_build_object('id', OLD.id) end)::text);
  return null;
end $$;
` + ['rooms', 'participants', 'artworks', 'comments']
  .map((t) => `create trigger _mock_${t} after insert or update or delete on public.${t} for each row execute function public._mock_notify();`)
  .join('\n');

const db = new PGlite();
await db.exec(STUBS);
await db.exec(schema);
await db.exec(NOTIFY);

// ---------------- auth ----------------
const users = new Map(); // id → {id,email,password,is_anonymous,meta}
const refreshTokens = new Map();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwtFor(u) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, aud: 'authenticated', role: 'authenticated', email: u.email ?? '', is_anonymous: u.is_anonymous, iat: now, exp: now + 3600, session_id: randomUUID() })}.mock`;
}
function claimsFrom(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (!p.sub) return null;
    return p;
  } catch {
    return null;
  }
}
function userObj(u) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email ?? '', is_anonymous: u.is_anonymous,
    app_metadata: { provider: u.is_anonymous ? 'anonymous' : 'email' }, user_metadata: u.meta ?? {},
    created_at: new Date().toISOString(), identities: [],
  };
}
function sessionFor(u) {
  const rt = randomUUID();
  refreshTokens.set(rt, u.id);
  return { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: rt, user: userObj(u) };
}

async function asUser(claims, fn) {
  return db.transaction(async (tx) => {
    if (claims) {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await tx.exec('set local role authenticated');
    } else {
      await tx.exec('set local role anon');
    }
    return fn(tx);
  });
}

// ---------------- storage bytes ----------------
const blobs = new Map(); // name → {buf, type}
const signed = new Map(); // token → name

// ---------------- helpers ----------------
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, x-supabase-api-version',
};
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { ...cors, ...(isBuf ? {} : { 'Content-Type': 'application/json' }), ...headers });
  res.end(isBuf ? body : body === undefined ? '' : JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
const pgErr = (e) => ({ code: e.code ?? 'P0001', details: null, hint: null, message: e.message });
const qi = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('bad identifier');
  return `"${s}"`;
};

let fnMeta = null;
async function getFnMeta(name) {
  if (!fnMeta) {
    const r = await db.query(`select p.proname, p.proretset, t.typtype, t.typname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype where n.nspname = 'public'`);
    fnMeta = new Map(r.rows.map((x) => [x.proname, x]));
  }
  return fnMeta.get(name);
}

let rejectAnonSignups = 0;

// ---------------- http ----------------
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const claims = claimsFrom(auth);

    // ---- 테스트 제어: 다음 익명 로그인 N번을 '횟수 제한(429)'으로 거절 (실제 Supabase 의 IP당 제한 흉내) ----
    if (p === '/__mock/reject-anon-signups' && req.method === 'POST') {
      rejectAnonSignups = Number(JSON.parse((await readBody(req)).toString() || '{}').count ?? 0);
      return send(res, 200, { ok: true });
    }

    // ---- Auth ----
    if (p === '/auth/v1/signup' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!body.email && rejectAnonSignups > 0) {
        rejectAnonSignups--;
        return send(res, 429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' }, { 'x-supabase-api-version': '2024-01-01' });
      }
      const u = body.email
        ? { id: randomUUID(), email: body.email, password: body.password, is_anonymous: false, meta: body.data ?? {} }
        : { id: randomUUID(), email: null, is_anonymous: true, meta: {} };
      if (u.email && [...users.values()].some((x) => x.email === u.email))
        return send(res, 422, { code: 'user_already_exists', message: 'User already registered', msg: 'User already registered' });
      users.set(u.id, u);
      await db.query(`insert into auth.users (id, email, is_anonymous, raw_user_meta_data) values ($1,$2,$3,$4)`, [u.id, u.email, u.is_anonymous, JSON.stringify(u.meta)]);
      return send(res, 200, sessionFor(u));
    }
    if (p === '/auth/v1/token' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const gt = url.searchParams.get('grant_type');
      if (gt === 'password') {
        const u = [...users.values()].find((x) => x.email === body.email && x.password === body.password);
        if (!u) return send(res, 400, { code: 'invalid_credentials', error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' });
        return send(res, 200, sessionFor(u));
      }
      if (gt === 'refresh_token') {
        const uid = refreshTokens.get(body.refresh_token);
        const u = uid && users.get(uid);
        if (!u) return send(res, 400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token', msg: 'Invalid Refresh Token' });
        return send(res, 200, sessionFor(u));
      }
    }
    if (p === '/auth/v1/user' && req.method === 'GET') {
      const u = claims && users.get(claims.sub);
      if (!u) return send(res, 401, { code: 'bad_jwt', message: 'invalid JWT', msg: 'invalid JWT' });
      return send(res, 200, userObj(u));
    }
    if (p === '/auth/v1/logout') return send(res, 204);

    // ---- PostgREST: RPC ----
    let m;
    if ((m = p.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)) && req.method === 'POST') {
      const fn = m[1];
      const meta = await getFnMeta(fn);
      if (!meta) return send(res, 404, { code: 'PGRST202', message: `function ${fn} not found` });
      const args = JSON.parse((await readBody(req)).toString() || '{}');
      const keys = Object.keys(args);
      const vals = keys.map((k) => (args[k] === null || args[k] === undefined ? null : typeof args[k] === 'object' ? JSON.stringify(args[k]) : typeof args[k] === 'boolean' ? args[k] : String(args[k])));
      const call = `public.${qi(fn)}(${keys.map((k, i) => `${qi(k)} => $${i + 1}`).join(', ')})`;
      try {
        const out = await asUser(claims, async (tx) => {
          if (meta.proretset) return (await tx.query(`select * from ${call}`, vals)).rows;
          if (meta.typtype === 'c') return (await tx.query(`select * from ${call}`, vals)).rows[0] ?? null;
          return (await tx.query(`select ${call} as v`, vals)).rows[0]?.v ?? null;
        });
        return send(res, 200, out);
      } catch (e) {
        if (process.env.MOCK_DEBUG) console.error('RPC', fn, args, e.message);
        return send(res, 400, pgErr(e));
      }
    }

    // ---- PostgREST: table select ----
    if ((m = p.match(/^\/rest\/v1\/([a-z_]+)$/)) && req.method === 'GET') {
      const table = m[1];
      const where = [];
      const vals = [];
      let order = '';
      let limit = '';
      let cols = '*';
      for (const [k, v] of url.searchParams) {
        if (k === 'select') {
          cols = v === '*' ? '*' : v.split(',').map((c) => qi(c.trim())).join(', ');
        } else if (k === 'order') {
          order = 'order by ' + v.split(',').map((o) => { const [c, dir] = o.split('.'); return `${qi(c)} ${dir === 'desc' ? 'desc' : 'asc'}`; }).join(', ');
        } else if (k === 'limit') {
          limit = `limit ${Number(v) | 0}`;
        } else if (k === 'offset') {
          /* 미사용 */
        } else {
          const mm = v.match(/^(eq|neq|is)\.(.*)$/);
          if (!mm) continue;
          if (mm[1] === 'is') where.push(`${qi(k)} is ${mm[2] === 'null' ? 'null' : 'not null'}`);
          else {
            vals.push(mm[2]);
            where.push(`${qi(k)}::text ${mm[1] === 'eq' ? '=' : '<>'} $${vals.length}`);
          }
        }
      }
      const sql = `select ${cols} from public.${qi(table)} ${where.length ? 'where ' + where.join(' and ') : ''} ${order} ${limit}`;
      try {
        const rows = await asUser(claims, async (tx) => (await tx.query(sql, vals)).rows);
        if ((req.headers.accept || '').includes('vnd.pgrst.object')) {
          if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` });
          return send(res, 200, rows[0]);
        }
        return send(res, 200, rows, { 'Content-Range': `0-${Math.max(0, rows.length - 1)}/*` });
      } catch (e) {
        return send(res, 400, pgErr(e));
      }
    }

    // ---- Storage ----
    if (p === '/storage/v1/object/sign/artworks' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const out = await asUser(claims, async (tx) => {
        const r = [];
        for (const name of body.paths ?? []) {
          const ok = (await tx.query(`select 1 from storage.objects where bucket_id='artworks' and name=$1`, [name])).rows.length > 0;
          if (ok) {
            const t = randomUUID();
            signed.set(t, name);
            r.push({ path: name, signedURL: `/object/sign/artworks/${name}?token=${t}`, error: null });
          } else r.push({ path: name, signedURL: null, error: 'Either the object does not exist or you do not have access to it' });
        }
        return r;
      });
      return send(res, 200, out);
    }
    if ((m = p.match(/^\/storage\/v1\/object\/sign\/artworks\/(.+)$/)) && req.method === 'GET') {
      const name = decodeURIComponent(m[1]);
      const t = url.searchParams.get('token');
      if (signed.get(t) !== name || !blobs.has(name)) return send(res, 400, { statusCode: '400', error: 'InvalidSignature', message: 'invalid signature' });
      const b = blobs.get(name);
      return send(res, 200, b.buf, { 'Content-Type': b.type, 'Cache-Control': 'max-age=31536000' });
    }
    if ((m = p.match(/^\/storage\/v1\/object\/(?:authenticated\/)?artworks\/(.+)$/))) {
      const name = decodeURIComponent(m[1]);
      if (req.method === 'POST' || req.method === 'PUT') {
        const raw = await readBody(req);
        let buf = raw;
        let type = req.headers['content-type'] || 'application/octet-stream';
        if (type.startsWith('multipart/form-data')) {
          const fd = await new Request('http://x', { method: 'POST', headers: { 'content-type': type }, body: raw }).formData();
          for (const [, v] of fd) {
            if (typeof v !== 'string') {
              buf = Buffer.from(await v.arrayBuffer());
              type = v.type || 'image/jpeg';
            }
          }
        }
        try {
          await asUser(claims, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('artworks', $1)`, [name]));
        } catch (e) {
          const dup = /duplicate|unique/i.test(e.message);
          return send(res, dup ? 409 : 400, { statusCode: dup ? '409' : '403', error: dup ? 'Duplicate' : 'Unauthorized', message: dup ? 'The resource already exists' : 'new row violates row-level security policy' });
        }
        blobs.set(name, { buf, type });
        return send(res, 200, { Key: `artworks/${name}`, Id: randomUUID() });
      }
      if (req.method === 'GET') {
        const ok = await asUser(claims, async (tx) => (await tx.query(`select 1 from storage.objects where bucket_id='artworks' and name=$1`, [name])).rows.length > 0);
        if (!ok || !blobs.has(name)) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        const b = blobs.get(name);
        return send(res, 200, b.buf, { 'Content-Type': b.type });
      }
    }
    if (p === '/storage/v1/object/artworks' && req.method === 'DELETE') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const removed = await asUser(claims, async (tx) => {
        const out = [];
        for (const name of body.prefixes ?? []) {
          const r = await tx.query(`delete from storage.objects where bucket_id='artworks' and name=$1 returning name`, [name]);
          if (r.rows.length) {
            blobs.delete(name);
            out.push({ name });
          }
        }
        return out;
      });
      return send(res, 200, removed);
    }

    send(res, 404, { message: `mock: ${req.method} ${p} not implemented` });
  } catch (e) {
    console.error(e);
    send(res, 500, { message: String(e?.message ?? e) });
  }
});

// ---------------- realtime (Phoenix vsn 2.0.0 JSON 배열 프로토콜) ----------------
const wss = new WebSocketServer({ noServer: true });
const sockets = new Set();
const presence = new Map(); // topic → Map(key → Map(socketId → meta))
let refSeq = 1;

function sendMsg(ws, join_ref, ref, topic, event, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify([join_ref, ref, topic, event, payload]));
}
function presenceStateOf(topic) {
  const out = {};
  for (const [key, bySock] of presence.get(topic) ?? new Map()) out[key] = { metas: [...bySock.values()] };
  return out;
}
function broadcastPresenceDiff(topic, joins, leaves) {
  for (const s of sockets) {
    const ch = s.channels.get(topic);
    if (ch) sendMsg(s.ws, ch.joinRef, null, topic, 'presence_diff', { joins, leaves });
  }
}
function untrack(s, topic) {
  const ch = s.channels.get(topic);
  if (!ch?.presenceKey) return;
  const bySock = presence.get(topic)?.get(ch.presenceKey);
  const meta = bySock?.get(s.id);
  if (meta) {
    bySock.delete(s.id);
    broadcastPresenceDiff(topic, {}, { [ch.presenceKey]: { metas: [meta] } });
  }
}

wss.on('connection', (ws) => {
  const s = { id: randomUUID(), ws, claims: null, channels: new Map() };
  sockets.add(s);
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const [join_ref, ref, topic, event, payload] = msg;
    if (topic === 'phoenix' && event === 'heartbeat') return sendMsg(ws, null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} });
    if (event === 'phx_join') {
      if (payload?.access_token) s.claims = claimsFrom(payload.access_token);
      const cfg = payload?.config ?? {};
      const bindings = (cfg.postgres_changes ?? []).map((b) => ({ ...b, id: refSeq++ }));
      s.channels.set(topic, { joinRef: join_ref, bindings, presenceKey: cfg.presence?.key || null });
      sendMsg(ws, join_ref, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: bindings } });
      if (cfg.presence?.enabled !== false) sendMsg(ws, join_ref, null, topic, 'presence_state', presenceStateOf(topic));
      return;
    }
    if (event === 'access_token') {
      if (payload?.access_token) s.claims = claimsFrom(payload.access_token);
      return;
    }
    if (event === 'presence') {
      const ch = s.channels.get(topic);
      if (ch && payload?.event === 'track') {
        const key = ch.presenceKey || s.id;
        ch.presenceKey = key;
        if (!presence.has(topic)) presence.set(topic, new Map());
        const tp = presence.get(topic);
        if (!tp.has(key)) tp.set(key, new Map());
        const prev = tp.get(key).get(s.id);
        const meta = { ...payload.payload, phx_ref: String(refSeq++) };
        tp.get(key).set(s.id, meta);
        broadcastPresenceDiff(topic, { [key]: { metas: [meta] } }, prev ? { [key]: { metas: [prev] } } : {});
      } else if (ch && payload?.event === 'untrack') {
        untrack(s, topic);
      }
      return sendMsg(ws, join_ref, ref, topic, 'phx_reply', { status: 'ok', response: {} });
    }
    if (event === 'phx_leave') {
      untrack(s, topic);
      s.channels.delete(topic);
      return sendMsg(ws, join_ref, ref, topic, 'phx_reply', { status: 'ok', response: {} });
    }
    if (ref) sendMsg(ws, join_ref, ref, topic, 'phx_reply', { status: 'ok', response: {} });
  });
  ws.on('close', () => {
    for (const topic of s.channels.keys()) untrack(s, topic);
    sockets.delete(s);
  });
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/realtime/v1/websocket')) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// DB 변경 → 구독자별 RLS 확인 후 전달 (Supabase Realtime 과 같은 방식)
await db.listen('mock_changes', async (text) => {
  const ch = JSON.parse(text);
  const row = ch.record ?? ch.old_record;
  for (const s of [...sockets]) {
    for (const [topic, c] of s.channels) {
      for (const b of c.bindings) {
        if (b.table !== ch.table || (b.event !== '*' && b.event !== ch.type)) continue;
        if (b.filter) {
          const [col, rest] = b.filter.split('=');
          const val = rest?.replace(/^eq\./, '');
          if (ch.type === 'DELETE') continue; // (실제 Supabase 도 DELETE 는 필터를 적용할 수 없음 → 여기서는 생략)
          if (String(row[col]) !== val) continue;
        }
        let visible = true;
        if (ch.type !== 'DELETE') {
          try {
            visible = await asUser(s.claims, async (tx) => (await tx.query(`select 1 from public.${qi(ch.table)} where id = $1`, [row.id])).rows.length > 0);
          } catch {
            visible = false;
          }
        }
        if (!visible) continue;
        sendMsg(s.ws, c.joinRef, null, topic, 'postgres_changes', {
          ids: [b.id],
          data: { schema: 'public', table: ch.table, commit_timestamp: new Date().toISOString(), type: ch.type, record: ch.record ?? {}, old_record: ch.old_record ?? {}, columns: [], errors: null },
        });
      }
    }
  }
});

server.listen(PORT, () => console.log(`mock supabase on http://localhost:${PORT}`));
