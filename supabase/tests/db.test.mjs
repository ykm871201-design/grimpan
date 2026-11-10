// DB 로직 자동 테스트 (PGlite = WebAssembly 로 실행되는 실제 PostgreSQL)
// Supabase 의 auth / storage 스키마를 최소한으로 흉내 낸 뒤, schema.sql 을 그대로 적용하고
// 실제 RLS·RPC 동작을 역할(authenticated)·JWT 클레임을 바꿔 가며 검증합니다.
// 실행: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(path.join(here, '..', 'schema.sql'), 'utf8');

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key, email text, is_anonymous boolean default false,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid default auth.uid(),
  created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant usage on schema auth, storage, public to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
`;

const db = new PGlite();
let passed = 0, failed = 0;
const results = [];
function ok(cond, name) {
  if (cond) { passed++; results.push(`  ✅ ${name}`); }
  else { failed++; results.push(`  ❌ ${name}`); }
}

// PGlite 는 단일 연결이므로 각 요청을 트랜잭션으로 감싸 사용자(JWT)·역할을 격리합니다.
// Promise.all 로 보낸 "동시 요청"은 DB 안에서 순서대로 직렬 실행됩니다.
async function asUser(uid, isAnon, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: uid, role: 'authenticated', is_anonymous: isAnon }),
    ]);
    await tx.exec(`set local role authenticated`);
    return fn(tx);
  });
}
async function expectError(promise, includes, name) {
  try { await promise; ok(false, `${name} (오류가 나야 하는데 성공함)`); }
  catch (e) { ok(!includes || String(e.message).includes(includes), `${name} → "${e.message}"`); }
}
async function newAnon() {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, is_anonymous) values ($1, true)`, [id]);
  return id;
}
async function uploadAs(uid, name) {
  return asUser(uid, true, (db) =>
    db.query(`insert into storage.objects (bucket_id, name) values ('artworks', $1)`, [name]));
}
async function submit(uid, roomId, tag) {
  const base = `${roomId}/${uid}/${Date.now()}-${tag}`;
  await uploadAs(uid, `${base}-full.jpg`);
  await uploadAs(uid, `${base}-thumb.jpg`);
  return asUser(uid, true, async (db) =>
    (await db.query(`select * from public.submit_artwork($1,$2,$3)`, [roomId, `${base}-full.jpg`, `${base}-thumb.jpg`])).rows[0]);
}

await db.exec(SUPABASE_STUBS);
await db.exec(schema);
results.push('스키마 적용 완료');

// --- 교사 2명 가입 (트리거로 teachers 자동 등록) ---
const teacherA = randomUUID(), teacherB = randomUUID();
await db.query(`insert into auth.users (id, email) values ($1,'a@school.kr'), ($2,'b@school.kr')`, [teacherA, teacherB]);
const tcount = (await db.query(`select count(*)::int n from public.teachers`)).rows[0].n;
ok(tcount === 2, '이메일 가입자는 teachers 에 자동 등록');

const roomA = await asUser(teacherA, false, async (db) =>
  (await db.query(`select * from public.create_room('봄 그림 그리기', 30)`)).rows[0]);
const roomB = await asUser(teacherB, false, async (db) =>
  (await db.query(`select * from public.create_room('다른 반 수업', 30)`)).rows[0]);
ok(/^[A-Z0-9]{6}$/.test(roomA.code) && roomA.phase === 'drawing', `수업방 생성 (코드 ${roomA.code})`);

results.push('\n[권한] 학생은 교사 기능을 쓸 수 없음');
const s1 = await newAnon();
await expectError(asUser(s1, true, (db) => db.query(`select public.create_room('해킹', 30)`)), '교사', '익명 학생의 수업방 생성 차단');
await expectError(asUser(s1, true, (db) => db.query(`select public.set_room_phase($1,'sharing')`, [roomA.id])), '권한', '학생의 단계 변경 차단');
await expectError(asUser(teacherB, false, (db) => db.query(`select public.set_room_phase($1,'sharing')`, [roomA.id])), '권한', '다른 교사의 수업방 단계 변경 차단');
await expectError(asUser(s1, true, (db) => db.query(`update public.rooms set phase='closed'`)), 'permission', '테이블 직접 UPDATE 차단');
await expectError(asUser(s1, true, (db) => db.query(`insert into public.artworks (room_id, participant_id, image_path, thumb_path) values ($1, gen_random_uuid(), 'x','y')`, [roomA.id])), 'permission', '테이블 직접 INSERT 차단');

results.push('\n[참여] 학생 30명 동시 참여 + 번호 중복 방지');
const students = [];
for (let n = 1; n <= 30; n++) students.push({ uid: await newAnon(), n });
await Promise.all(students.map((s) =>
  asUser(s.uid, true, async (db) => {
    s.p = (await db.query(`select * from public.join_room($1,$2,$3)`, [roomA.code.toLowerCase(), s.n, `학생${s.n}`])).rows[0];
  })));
const pcount = await asUser(teacherA, false, async (db) => (await db.query(`select count(*)::int n from public.participants where room_id=$1`, [roomA.id])).rows[0].n);
ok(pcount === 30, '30명 모두 참여 (코드 소문자 입력도 허용)');
const intruder = await newAnon();
await expectError(asUser(intruder, true, (db) => db.query(`select public.join_room($1, 5, '가짜5번')`, [roomA.code])), '이미 다른 친구', '이미 사용 중인 번호 차단');
await expectError(asUser(intruder, true, (db) => db.query(`select public.join_room($1, 31, '초과')`, [roomA.code])), '30번까지', '최대 인원 초과 번호 차단');
const again = await asUser(students[4].uid, true, async (db) => (await db.query(`select * from public.join_room($1, 5, '새별명')`, [roomA.code])).rows[0]);
ok(again.id === students[4].p.id && again.nickname === '새별명', '같은 기기 재접속(새로고침) 시 기존 참여 정보 복구');

results.push('\n[제출] 30명 동시 제출, 같은 학생 3회 재제출');
await Promise.all(students.slice(0, 28).map((s) => submit(s.uid, roomA.id, 'v1')));
const s5 = students[4];
const v2 = await submit(s5.uid, roomA.id, 'v2');
const v3 = await submit(s5.uid, roomA.id, 'v3');
const all = await asUser(teacherA, false, async (db) => (await db.query(`select * from public.artworks where room_id=$1`, [roomA.id])).rows);
ok(all.length === 28, `작품 수 28개 (미제출 2명), 실제 ${all.length}`);
const mine = all.filter((a) => a.participant_id === s5.p.id);
ok(mine.length === 1 && mine[0].version === 3 && mine[0].image_path === v3.image_path, '5번 학생 3회 제출 → 작품 1개, version 3, 최신 이미지 경로');
ok(v2.image_path !== v3.image_path, '재제출마다 새 파일 경로 (브라우저 캐시 문제 방지)');
const hist = await asUser(teacherA, false, async (db) => (await db.query(`select count(*)::int n from public.artwork_versions where artwork_id=$1`, [mine[0].id])).rows[0].n);
ok(hist === 3, '제출 이력 3건 내부 보관');

const s6 = students[5];
await expectError(asUser(s6.uid, true, (db) => db.query(`select public.submit_artwork($1,$2,$3)`, [roomA.id, v3.image_path, v3.thumb_path])), '잘못된 이미지 경로', '다른 학생 파일 경로로 제출(덮어쓰기) 차단');
await expectError(asUser(s6.uid, true, (db) => db.query(`select public.submit_artwork($1,$2,$3)`, [roomA.id, `${roomA.id}/${s6.uid}/none-full.jpg`, `${roomA.id}/${s6.uid}/none-thumb.jpg`])), '업로드가 완료되지', '업로드되지 않은 파일로 제출 차단');
await expectError(asUser(s6.uid, true, (db) => db.query(`insert into storage.objects (bucket_id, name) values ('artworks', $1)`, [`${roomA.id}/${s5.uid}/evil.jpg`])), 'row-level security', 'Storage: 다른 학생 폴더 업로드 차단');
await expectError(asUser(s6.uid, true, (db) => db.query(`insert into storage.objects (bucket_id, name) values ('artworks', $1)`, [`${roomB.id}/${s6.uid}/evil.jpg`])), 'row-level security', 'Storage: 참여하지 않은 수업방 업로드 차단');
await expectError(asUser(s6.uid, true, (db) => db.query(`select public.submit_artwork($1,$2,$3)`, [roomB.id, `${roomB.id}/${s6.uid}/a.jpg`, `${roomB.id}/${s6.uid}/b.jpg`])), '참여한 학생만', '수업방 ID만 바꿔 다른 수업방 제출 차단');

results.push('\n[공개/숨김]');
const art7 = all.find((a) => a.participant_id === students[6].p.id);
const rev0 = (await db.query(`select moderation_rev from public.rooms where id=$1`, [roomA.id])).rows[0].moderation_rev;
await asUser(teacherA, false, (db) => db.query(`select public.set_artwork_visibility($1,false)`, [art7.id]));
const seenByS1 = await asUser(students[0].uid, true, async (db) => (await db.query(`select id from public.artworks where room_id=$1`, [roomA.id])).rows.map((r) => r.id));
ok(!seenByS1.includes(art7.id) && seenByS1.length === 27, '숨긴 작품은 다른 학생에게 안 보임');
const seenByOwner = await asUser(students[6].uid, true, async (db) => (await db.query(`select id from public.artworks where id=$1`, [art7.id])).rows.length);
ok(seenByOwner === 1, '숨겨진 작품도 본인에게는 보임');
const canReadHidden = await asUser(students[0].uid, true, async (db) => (await db.query(`select count(*)::int n from storage.objects where name=$1`, [art7.thumb_path])).rows[0].n);
ok(canReadHidden === 0, 'Storage: 숨긴 작품 이미지 파일 접근 차단');
const canReadVisible = await asUser(students[0].uid, true, async (db) => (await db.query(`select count(*)::int n from storage.objects where name=$1`, [mine[0].thumb_path])).rows[0].n);
ok(canReadVisible === 1, 'Storage: 공개 작품 최신 썸네일 접근 허용');
const canReadOld = await asUser(students[0].uid, true, async (db) => (await db.query(`select count(*)::int n from storage.objects where name=$1`, [v2.thumb_path])).rows[0].n);
ok(canReadOld === 0, 'Storage: 다른 학생의 이전 버전 파일 접근 차단');
const teacherSees = await asUser(teacherA, false, async (db) => (await db.query(`select count(*)::int n from public.artworks where room_id=$1`, [roomA.id])).rows[0].n);
ok(teacherSees === 28, '교사는 숨긴 작품 포함 전체 확인');
const rev1 = (await db.query(`select moderation_rev from public.rooms where id=$1`, [roomA.id])).rows[0].moderation_rev;
ok(rev1 === rev0 + 1, '숨김 시 moderation_rev 증가 (학생 화면 실시간 갱신 신호)');
await asUser(teacherA, false, (db) => db.query(`select public.set_all_artworks_visibility($1,false)`, [roomA.id]));
const afterAllHide = await asUser(students[0].uid, true, async (db) => (await db.query(`select count(*)::int n from public.artworks where room_id=$1`, [roomA.id])).rows[0].n);
ok(afterAllHide === 1, '전체 숨김 → 학생에게는 자기 작품만 보임');
await asUser(teacherA, false, (db) => db.query(`select public.set_all_artworks_visibility($1,true)`, [roomA.id]));
await asUser(teacherA, false, (db) => db.query(`select public.set_artwork_visibility($1,false)`, [art7.id]));

results.push('\n[단계 전환 · 댓글]');
const target = mine[0]; // 5번 작품
await expectError(asUser(students[0].uid, true, (db) => db.query(`select public.post_comment($1,'멋져요')`, [target.id])), '댓글을 쓸 수 없는 시간', '그림 단계에서는 댓글 차단');
await asUser(teacherA, false, (db) => db.query(`select public.set_room_phase($1,'sharing')`, [roomA.id]));
const phaseSeen = await asUser(students[10].uid, true, async (db) => (await db.query(`select phase from public.rooms where id=$1`, [roomA.id])).rows[0].phase);
ok(phaseSeen === 'sharing', '학생에게 바뀐 단계(sharing) 조회됨');
await expectError(submit(students[0].uid, roomA.id, 'late'), null, '감상 단계(재제출 미허용)에서 제출 차단');
await asUser(teacherA, false, (db) => db.query(`select public.update_room_settings($1, null, true)`, [roomA.id]));
const late = await submit(students[0].uid, roomA.id, 'late2');
ok(late.version === 2, '교사가 재제출 허용 시 감상 단계에서도 재제출 가능');

const commenters = students.slice(0, 20).filter((s) => s !== s5);
await Promise.all(commenters.map((s, i) =>
  asUser(s.uid, true, (db) => db.query(`select public.post_comment($1,$2)`, [target.id, `  색깔이   예뻐요 ${i}  `]))));
const ccount = await asUser(teacherA, false, async (db) => (await db.query(`select count(*)::int n from public.comments where artwork_id=$1`, [target.id])).rows[0].n);
ok(ccount === commenters.length, `동시에 댓글 ${commenters.length}개 등록`);
const sample = await asUser(teacherA, false, async (db) => (await db.query(`select body from public.comments where artwork_id=$1 limit 1`, [target.id])).rows[0].body);
ok(!/\s{2,}/.test(sample) && sample === sample.trim(), '댓글 공백 정리');
await expectError(asUser(students[0].uid, true, (db) => db.query(`select public.post_comment($1,'또 써요')`, [target.id])), '너무 빨라요', '3초 내 연속 등록 차단');
await expectError(asUser(students[1].uid, true, (db) => db.query(`select public.post_comment($1,'   ')`, [all[2].id])), '내용을 입력', '빈 댓글 차단');
await expectError(asUser(students[1].uid, true, (db) => db.query(`select public.post_comment($1,$2)`, [all[2].id, '가'.repeat(101)])), '100자', '100자 초과 차단');
await expectError(asUser(s5.uid, true, (db) => db.query(`select public.post_comment($1,'내 그림 최고')`, [target.id])), '내 작품', '자기 작품 댓글 차단');
await expectError(asUser(students[2].uid, true, (db) => db.query(`select public.post_comment($1,'몰래')`, [art7.id])), '볼 수 없는', '숨긴 작품 댓글 차단');

const oneComment = await asUser(teacherA, false, async (db) => (await db.query(`select id from public.comments where artwork_id=$1 limit 1`, [target.id])).rows[0].id);
await asUser(teacherA, false, (db) => db.query(`select public.set_comment_hidden($1,true)`, [oneComment]));
const visibleToStudent = await asUser(students[25].uid, true, async (db) => (await db.query(`select count(*)::int n from public.comments where artwork_id=$1`, [target.id])).rows[0].n);
ok(visibleToStudent === commenters.length - 1, '교사가 숨긴 댓글은 학생에게 안 보임');
await expectError(asUser(students[3].uid, true, (db) => db.query(`select public.delete_comment($1)`, [oneComment])), '권한', '학생의 댓글 삭제 차단');
await asUser(teacherA, false, (db) => db.query(`select public.delete_comment($1)`, [oneComment]));
ok((await db.query(`select count(*)::int n from public.comments where id=$1`, [oneComment])).rows[0].n === 0, '교사 댓글 삭제');

await asUser(teacherA, false, (db) => db.query(`select public.update_room_settings($1, false)`, [roomA.id]));
await expectError(asUser(students[28].uid, true, (db) => db.query(`select public.post_comment($1,'멈춤 테스트')`, [target.id])), '멈췄어요', '교사가 댓글 중단 시 등록 차단');
await asUser(teacherA, false, (db) => db.query(`select public.update_room_settings($1, true)`, [roomA.id]));

results.push('\n[수업방 격리]');
const outsider = await newAnon();
await asUser(outsider, true, (db) => db.query(`select public.join_room($1, 1, '다른반1')`, [roomB.code]));
const leak = await asUser(outsider, true, async (db) => {
  const a = (await db.query(`select count(*)::int n from public.artworks`)).rows[0].n;
  const c = (await db.query(`select count(*)::int n from public.comments`)).rows[0].n;
  const p = (await db.query(`select count(*)::int n from public.participants`)).rows[0].n;
  const r = (await db.query(`select count(*)::int n from public.rooms`)).rows[0].n;
  const o = (await db.query(`select count(*)::int n from storage.objects`)).rows[0].n;
  return { a, c, p, r, o };
});
ok(leak.a === 0 && leak.c === 0 && leak.p === 1 && leak.r === 1 && leak.o === 0, `다른 수업방 학생에게 A반 데이터 0건 노출 ${JSON.stringify(leak)}`);
const teacherBsees = await asUser(teacherB, false, async (db) => (await db.query(`select count(*)::int n from public.artworks`)).rows[0].n);
ok(teacherBsees === 0, '다른 교사에게도 A반 작품 비노출');

results.push('\n[기기 변경 · 수업 종료]');
await asUser(teacherA, false, (db) => db.query(`select public.release_participant($1)`, [s5.p.id]));
const newDevice = await newAnon();
const claimed = await asUser(newDevice, true, async (db) => (await db.query(`select * from public.join_room($1, 5, '5번새기기')`, [roomA.code])).rows[0]);
ok(claimed.id === s5.p.id, '교사가 번호 재설정 → 새 기기가 같은 번호·기존 작품 이어받음');
const claimedArt = await asUser(newDevice, true, async (db) => (await db.query(`select version from public.artworks where participant_id=$1`, [claimed.id])).rows[0]);
ok(claimedArt?.version === 3, '이어받은 기기에서 기존 작품 조회');

await asUser(teacherA, false, (db) => db.query(`select public.set_room_phase($1,'closed')`, [roomA.id]));
await expectError(asUser(students[1].uid, true, (db) => db.query(`select public.post_comment($1,'끝난 뒤')`, [target.id])), null, '수업 종료 후 댓글 차단');
await expectError(submit(students[1].uid, roomA.id, 'after'), null, '수업 종료 후 제출 차단');
await expectError(asUser(await newAnon(), true, (db) => db.query(`select public.join_room($1, 29, '늦게')`, [roomA.code])), '끝난 수업', '수업 종료 후 신규 참여 차단');
const stillReadable = await asUser(teacherA, false, async (db) => (await db.query(`select count(*)::int n from public.comments where room_id=$1`, [roomA.id])).rows[0].n);
ok(stillReadable > 0, '수업 종료 후에도 교사는 결과물 열람 가능');

console.log(results.join('\n'));
console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
process.exit(failed ? 1 : 0);
