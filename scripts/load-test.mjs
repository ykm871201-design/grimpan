// 동시 접속 부하 테스트: 학생 N명(기본 30)이 동시에 접속·제출·재제출·댓글 작성
// 실제 Supabase 프로젝트에 대해 실행할 수 있습니다. (테스트용 수업방을 따로 만들어 사용하세요)
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=... ROOM_CODE=AB12CD \
//   TEACHER_EMAIL=me@school.kr TEACHER_PASSWORD=... N=30 npm run load-test
//
// ⚠️ Supabase 기본 설정은 '익명 로그인 시간당 30회/IP' 제한이 있어 한 컴퓨터에서 30명 이상 테스트하면 막힙니다.
//    Authentication > Rate Limits 에서 익명 로그인 한도를 올린 뒤 실행하세요. (실제 교실도 같은 공유기 IP 를 쓰므로 필수)
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const CODE = process.env.ROOM_CODE;
const N = Number(process.env.N || 30);
const START = Number(process.env.START || 1);
if (!URL_ || !KEY || !CODE) {
  console.error('SUPABASE_URL, SUPABASE_ANON_KEY, ROOM_CODE 환경변수가 필요합니다.');
  process.exit(1);
}
const mk = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// 1×1 흰색 JPEG
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const blob = () => new Blob([JPEG], { type: 'image/jpeg' });
const t0 = () => performance.now();
const ms = (s) => `${Math.round(performance.now() - s)}ms`;
const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
let failures = 0;
const ok = (c, msg) => { console.log(`${c ? '✅' : '❌'} ${msg}`); if (!c) failures++; };

// ---- 교사(선택): 실시간 이벤트 수신 확인 ----
let teacher = null, roomId = null;
const recv = { artworks: 0, comments: 0, participants: 0 };
if (process.env.TEACHER_EMAIL) {
  teacher = mk();
  const { error } = await teacher.auth.signInWithPassword({ email: process.env.TEACHER_EMAIL, password: process.env.TEACHER_PASSWORD });
  if (error) throw error;
  const { data } = await teacher.from('rooms').select('*').eq('code', CODE).single();
  roomId = data.id;
  await new Promise((res) => {
    teacher.channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'artworks', filter: `room_id=eq.${roomId}` }, () => recv.artworks++)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `room_id=eq.${roomId}` }, () => recv.comments++)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` }, () => recv.participants++)
      .subscribe((s) => s === 'SUBSCRIBED' && res());
  });
  await teacher.rpc('set_room_phase', { p_room_id: roomId, p_phase: 'drawing' });
  console.log('교사 실시간 구독 완료');
}

// ---- 1) 학생 N명 동시 접속 ----
let s = t0();
const students = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const sb = mk();
  const st = t0();
  const { data: a, error: e1 } = await sb.auth.signInAnonymously();
  if (e1) return { err: e1.message };
  const { data: p, error: e2 } = await sb.rpc('join_room', { p_code: CODE, p_student_number: START + i, p_nickname: `부하${START + i}` });
  if (e2) return { err: e2.message };
  return { sb, uid: a.user.id, p, room: p.room_id, joinMs: performance.now() - st };
}));
const joined = students.filter((x) => !x.err);
students.filter((x) => x.err).slice(0, 3).forEach((x) => console.log('   접속 오류:', x.err));
ok(joined.length === N, `학생 ${N}명 동시 접속: ${joined.length}명 성공 (${ms(s)}, p95 ${Math.round(pct(joined.map((x) => x.joinMs), 0.95) || 0)}ms)`);
roomId ??= joined[0]?.room;

// ---- 2) 동시 제출 ----
async function submit(x, tag) {
  const base = `${x.room}/${x.uid}/${Date.now()}-${tag}`;
  const st = t0();
  for (const kind of ['thumb', 'full']) {
    const { error } = await x.sb.storage.from('artworks').upload(`${base}-${kind}.jpg`, blob(), { contentType: 'image/jpeg' });
    if (error) throw error;
  }
  const { data, error } = await x.sb.rpc('submit_artwork', { p_room_id: x.room, p_image_path: `${base}-full.jpg`, p_thumb_path: `${base}-thumb.jpg` });
  if (error) throw error;
  return { art: data, t: performance.now() - st };
}
s = t0();
const subs = await Promise.allSettled(joined.map((x) => submit(x, 'v1')));
const good = subs.filter((r) => r.status === 'fulfilled').map((r) => r.value);
subs.filter((r) => r.status === 'rejected').slice(0, 3).forEach((r) => console.log('   제출 오류:', r.reason?.message));
ok(good.length === joined.length, `${joined.length}명 동시 제출: ${good.length}건 성공 (${ms(s)}, p95 ${Math.round(pct(good.map((g) => g.t), 0.95) || 0)}ms)`);

// ---- 3) 같은 학생 3회 제출 ----
const one = joined[0];
await submit(one, 'v2');
const last = await submit(one, 'v3');
const { data: mine } = await one.sb.from('artworks').select('*').eq('participant_id', one.p.id);
ok(mine.length === 1 && last.art.version === 3, `같은 학생 3회 제출 → 작품 ${mine.length}개, version ${last.art.version}`);

// ---- 4) 동시 댓글 ----
if (teacher) {
  await teacher.rpc('set_room_phase', { p_room_id: roomId, p_phase: 'sharing' });
  const arts = good.map((g) => g.art);
  s = t0();
  const cs = await Promise.allSettled(joined.map((x, i) => {
    const target = arts[(i + 1) % arts.length];
    return x.sb.rpc('post_comment', { p_artwork_id: target.id, p_body: `부하 테스트 댓글 ${i + 1}` }).then((r) => { if (r.error) throw r.error; });
  }));
  const cOk = cs.filter((r) => r.status === 'fulfilled').length;
  cs.filter((r) => r.status === 'rejected').slice(0, 3).forEach((r) => console.log('   댓글 오류:', r.reason?.message));
  ok(cOk === joined.length, `${joined.length}명 동시 댓글: ${cOk}건 성공 (${ms(s)})`);
  await new Promise((r) => setTimeout(r, 3000));
  ok(recv.artworks >= good.length + 2, `교사 실시간 수신 — 작품 이벤트 ${recv.artworks}건 (기대 ≥ ${good.length + 2})`);
  ok(recv.comments >= cOk, `교사 실시간 수신 — 댓글 이벤트 ${recv.comments}건 (기대 ≥ ${cOk})`);
  console.log(`   (참여 이벤트 ${recv.participants}건)`);
}
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);
