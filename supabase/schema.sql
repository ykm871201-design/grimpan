-- =====================================================================
--  우리반 그림판 (실시간 협동 그림판 · 작품 감상) — Supabase 스키마
--  Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 [Run] 하세요.
--  여러 번 실행해도 안전하도록(idempotent) 작성되어 있습니다.
--
--  보안 원칙
--   1) 모든 테이블에 RLS 를 켜고, 클라이언트(anon/authenticated)에는 SELECT 만 허용합니다.
--   2) 쓰기(INSERT/UPDATE/DELETE)는 전부 아래 RPC 함수(security definer)로만 가능하며,
--      함수 안에서 "교사 본인 수업방인지", "그 수업방의 참여 학생인지", "현재 단계에서 허용되는지"를 검사합니다.
--   3) 학생 = Supabase 익명 로그인 사용자(auth.jwt() ->> 'is_anonymous' = true)
--      교사 = 이메일/비밀번호 가입자(public.teachers 에 자동 등록)
-- =====================================================================

-- gen_random_uuid() 는 PostgreSQL 13+ 기본 내장 함수입니다.

-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------

-- 교사 계정 (auth.users 중 익명이 아닌 사용자)
create table if not exists public.teachers (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- 수업방
create table if not exists public.rooms (
  id                       uuid primary key default gen_random_uuid(),
  teacher_id               uuid not null references public.teachers(id) on delete cascade,
  title                    text not null check (char_length(title) between 1 and 60),
  code                     text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  max_students             int  not null default 30 check (max_students between 1 and 60),
  phase                    text not null default 'drawing' check (phase in ('drawing','sharing','closed')),
  comments_enabled         boolean not null default true,
  allow_resubmit_in_sharing boolean not null default false,
  moderation_rev           int  not null default 0,   -- 교사가 숨김/삭제할 때 증가 → 학생 화면이 목록을 다시 불러옴
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  closed_at                timestamptz
);
create index if not exists rooms_teacher_idx on public.rooms(teacher_id, created_at desc);

-- 학생 참여 정보 (수업방마다 출석번호 1개 = 학생 1명)
create table if not exists public.participants (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,  -- 익명 세션. 교사가 '번호 재설정'하면 null
  student_number int  not null check (student_number between 1 and 60),
  nickname       text not null check (char_length(nickname) between 1 and 12),
  joined_at      timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (room_id, student_number),
  unique (room_id, user_id)
);
create index if not exists participants_user_idx on public.participants(user_id);

-- 학생 작품: 학생 1명당 수업방에 작품 1개 (participant_id unique)
create table if not exists public.artworks (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms(id) on delete cascade,
  participant_id uuid not null unique references public.participants(id) on delete cascade,
  image_path     text not null,
  thumb_path     text not null,
  version        int  not null default 1,
  is_visible     boolean not null default true,
  submitted_at   timestamptz not null default now(),   -- 최초 제출
  updated_at     timestamptz not null default now()    -- 최근 (재)제출
);
create index if not exists artworks_room_idx on public.artworks(room_id);

-- 제출 이력 (내부 보관용, 게시판에는 artworks 의 최신본만 표시)
create table if not exists public.artwork_versions (
  id          bigint generated always as identity primary key,
  artwork_id  uuid not null references public.artworks(id) on delete cascade,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  version     int  not null,
  image_path  text not null,
  thumb_path  text not null,
  created_at  timestamptz not null default now()
);
create index if not exists artwork_versions_room_idx on public.artwork_versions(room_id);

-- 작품 댓글
create table if not exists public.comments (
  id                    uuid primary key default gen_random_uuid(),
  room_id               uuid not null references public.rooms(id) on delete cascade,
  artwork_id            uuid not null references public.artworks(id) on delete cascade,
  author_participant_id uuid not null references public.participants(id) on delete cascade,
  body                  text not null check (char_length(body) between 1 and 100),
  is_hidden             boolean not null default false,
  created_at            timestamptz not null default now()
);
create index if not exists comments_room_idx on public.comments(room_id, created_at desc);
create index if not exists comments_author_idx on public.comments(author_participant_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. 교사 자동 등록 (이메일 가입 시)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_anonymous, false) = false then
    insert into public.teachers (id, email, display_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email,''), '@', 1)))
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 이미 가입된 이메일 사용자 보정
insert into public.teachers (id, email, display_name)
select u.id, u.email, split_part(coalesce(u.email,''), '@', 1)
from auth.users u
where coalesce(u.is_anonymous, false) = false
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. 권한 검사 도우미 함수 (RLS 재귀 방지를 위해 security definer)
-- ---------------------------------------------------------------------
create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teachers t where t.id = auth.uid())
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

create or replace function public.is_room_teacher(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rooms r where r.id = p_room_id and r.teacher_id = auth.uid())
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

create or replace function public.my_participant_id(p_room_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from public.participants p
  where p.room_id = p_room_id and p.user_id = auth.uid() and auth.uid() is not null
  limit 1;
$$;

create or replace function public.is_room_participant(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_participant_id(p_room_id) is not null;
$$;

-- ---------------------------------------------------------------------
-- 4. RLS (읽기 정책)
-- ---------------------------------------------------------------------
alter table public.teachers         enable row level security;
alter table public.rooms            enable row level security;
alter table public.participants     enable row level security;
alter table public.artworks         enable row level security;
alter table public.artwork_versions enable row level security;
alter table public.comments         enable row level security;

drop policy if exists teachers_select_self on public.teachers;
create policy teachers_select_self on public.teachers
  for select to authenticated using (id = auth.uid());

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select to authenticated
  using (teacher_id = auth.uid() or public.is_room_participant(id));

drop policy if exists participants_select on public.participants;
create policy participants_select on public.participants
  for select to authenticated
  using (public.is_room_teacher(room_id) or public.is_room_participant(room_id));

-- 학생: 공개된 작품 + 자기 작품 / 교사: 자기 수업방 전부(숨김 포함)
drop policy if exists artworks_select on public.artworks;
create policy artworks_select on public.artworks
  for select to authenticated
  using (
    public.is_room_teacher(room_id)
    or participant_id = public.my_participant_id(room_id)
    or (is_visible and public.is_room_participant(room_id))
  );

drop policy if exists artwork_versions_select on public.artwork_versions;
create policy artwork_versions_select on public.artwork_versions
  for select to authenticated using (public.is_room_teacher(room_id));

-- 학생: 숨김되지 않은 댓글 중, 공개된 작품(또는 내 작품)에 달린 것 / 교사: 전부
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated
  using (
    public.is_room_teacher(room_id)
    or (
      not is_hidden
      and public.is_room_participant(room_id)
      and exists (
        select 1 from public.artworks a
        where a.id = comments.artwork_id
          and (a.is_visible or a.participant_id = public.my_participant_id(a.room_id))
      )
    )
  );

-- 클라이언트 역할에는 SELECT 만. 쓰기는 RPC 로만.
revoke all on public.teachers, public.rooms, public.participants, public.artworks,
              public.artwork_versions, public.comments from anon, authenticated;
grant select on public.teachers, public.rooms, public.participants, public.artworks,
               public.artwork_versions, public.comments to authenticated;

-- ---------------------------------------------------------------------
-- 5. RPC — 학생용
-- ---------------------------------------------------------------------

-- 수업방 코드로 최소 정보 조회 (참여 전 화면용)
create or replace function public.get_room_by_code(p_code text)
returns table (id uuid, title text, phase text, max_students int)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '세션이 없습니다. 페이지를 새로고침해 주세요.'; end if;
  return query
    select r.id, r.title, r.phase, r.max_students
    from public.rooms r where r.code = upper(trim(p_code));
end $$;

-- 수업방 참여 (출석번호 + 별명)
create or replace function public.join_room(p_code text, p_student_number int, p_nickname text)
returns public.participants
language plpgsql security definer set search_path = public as $$
declare
  v_room public.rooms;
  v_me   public.participants;
  v_slot public.participants;
  v_nick text := trim(coalesce(p_nickname, ''));
begin
  if auth.uid() is null then raise exception '세션이 없습니다. 페이지를 새로고침해 주세요.'; end if;

  select * into v_room from public.rooms where code = upper(trim(p_code));
  if not found then raise exception '수업방을 찾을 수 없어요. 코드를 다시 확인해 주세요.'; end if;
  if v_room.phase = 'closed' then raise exception '이미 끝난 수업이에요.'; end if;
  if p_student_number is null or p_student_number < 1 or p_student_number > v_room.max_students then
    raise exception '번호는 1번부터 %번까지 입력할 수 있어요.', v_room.max_students;
  end if;
  if char_length(v_nick) < 1 or char_length(v_nick) > 12 then
    raise exception '별명은 1~12글자로 입력해 주세요.';
  end if;

  -- 같은 수업방 동시 참여 직렬화
  perform pg_advisory_xact_lock(hashtext('join:' || v_room.id::text));

  select * into v_me from public.participants where room_id = v_room.id and user_id = auth.uid();
  select * into v_slot from public.participants where room_id = v_room.id and student_number = p_student_number;

  if v_me.id is not null then
    -- 이미 참여한 기기: 같은 번호면 별명만 갱신
    if v_me.student_number = p_student_number then
      update public.participants set nickname = v_nick, last_seen_at = now()
      where id = v_me.id returning * into v_me;
      return v_me;
    end if;
    if v_slot.id is not null then raise exception '%번은 이미 다른 친구가 사용 중이에요.', p_student_number; end if;
    update public.participants set student_number = p_student_number, nickname = v_nick, last_seen_at = now()
    where id = v_me.id returning * into v_me;
    return v_me;
  end if;

  if v_slot.id is not null then
    if v_slot.user_id is null then
      -- 교사가 '번호 재설정'한 자리: 새 기기가 이어받음 (기존 작품 유지)
      update public.participants set user_id = auth.uid(), nickname = v_nick, last_seen_at = now()
      where id = v_slot.id returning * into v_me;
      return v_me;
    end if;
    raise exception '%번은 이미 다른 친구가 사용 중이에요. 내 번호가 맞다면 선생님께 말씀드리세요.', p_student_number;
  end if;

  insert into public.participants (room_id, user_id, student_number, nickname)
  values (v_room.id, auth.uid(), p_student_number, v_nick)
  returning * into v_me;
  return v_me;
end $$;

-- 그림 제출/재제출: 학생당 작품 1개를 최신 이미지로 교체
create or replace function public.submit_artwork(p_room_id uuid, p_image_path text, p_thumb_path text)
returns public.artworks
language plpgsql security definer set search_path = public as $$
declare
  v_room   public.rooms;
  v_pid    uuid;
  v_prefix text;
  v_art    public.artworks;
begin
  if auth.uid() is null then raise exception '세션이 없습니다.'; end if;
  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception '수업방을 찾을 수 없어요.'; end if;

  v_pid := public.my_participant_id(p_room_id);
  if v_pid is null then raise exception '이 수업방에 참여한 학생만 제출할 수 있어요.'; end if;

  if v_room.phase = 'closed' then raise exception '수업이 끝나서 제출할 수 없어요.'; end if;
  if v_room.phase = 'sharing' and not v_room.allow_resubmit_in_sharing then
    raise exception '지금은 감상 시간이라 그림을 제출할 수 없어요.';
  end if;

  -- 경로는 반드시 "수업방ID/내 세션ID/..." 이어야 함 (다른 수업방·다른 학생 경로 차단)
  v_prefix := p_room_id::text || '/' || auth.uid()::text || '/';
  if left(p_image_path, length(v_prefix)) <> v_prefix or left(p_thumb_path, length(v_prefix)) <> v_prefix
     or position('..' in p_image_path) > 0 or position('..' in p_thumb_path) > 0 then
    raise exception '잘못된 이미지 경로입니다.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'artworks' and o.name = p_image_path)
     or not exists (select 1 from storage.objects o where o.bucket_id = 'artworks' and o.name = p_thumb_path) then
    raise exception '이미지 업로드가 완료되지 않았어요. 다시 시도해 주세요.';
  end if;

  insert into public.artworks (room_id, participant_id, image_path, thumb_path)
  values (p_room_id, v_pid, p_image_path, p_thumb_path)
  on conflict (participant_id) do update
    set image_path = excluded.image_path,
        thumb_path = excluded.thumb_path,
        version    = public.artworks.version + 1,
        updated_at = now()
  returning * into v_art;

  insert into public.artwork_versions (artwork_id, room_id, version, image_path, thumb_path)
  values (v_art.id, p_room_id, v_art.version, p_image_path, p_thumb_path);

  return v_art;
end $$;

-- 댓글 등록 (단계·허용 여부·길이·연속 등록 검사)
create or replace function public.post_comment(p_artwork_id uuid, p_body text)
returns public.comments
language plpgsql security definer set search_path = public as $$
declare
  v_art  public.artworks;
  v_room public.rooms;
  v_pid  uuid;
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
  v_last timestamptz;
  v_c    public.comments;
begin
  if auth.uid() is null then raise exception '세션이 없습니다.'; end if;
  select * into v_art from public.artworks where id = p_artwork_id;
  if not found then raise exception '작품을 찾을 수 없어요.'; end if;
  select * into v_room from public.rooms where id = v_art.room_id;

  v_pid := public.my_participant_id(v_art.room_id);
  if v_pid is null then raise exception '이 수업방에 참여한 학생만 댓글을 쓸 수 있어요.'; end if;
  if v_room.phase <> 'sharing' then raise exception '지금은 댓글을 쓸 수 없는 시간이에요.'; end if;
  if not v_room.comments_enabled then raise exception '선생님이 댓글 쓰기를 잠시 멈췄어요.'; end if;
  if not v_art.is_visible then raise exception '지금은 볼 수 없는 작품이에요.'; end if;
  if v_art.participant_id = v_pid then raise exception '내 작품에는 댓글을 쓸 수 없어요. 친구의 작품에 남겨 보세요!'; end if;
  if char_length(v_body) < 1 then raise exception '댓글 내용을 입력해 주세요.'; end if;
  if char_length(v_body) > 100 then raise exception '댓글은 100자까지 쓸 수 있어요.'; end if;

  -- 같은 학생의 동시 요청 직렬화 + 3초 연속 등록 제한
  perform pg_advisory_xact_lock(hashtext('comment:' || v_pid::text));
  select max(created_at) into v_last from public.comments where author_participant_id = v_pid;
  if v_last is not null and v_last > now() - interval '3 seconds' then
    raise exception '너무 빨라요! 잠시 후에 다시 써 주세요.';
  end if;
  if (select count(*) from public.comments where author_participant_id = v_pid) >= 200 then
    raise exception '댓글을 너무 많이 썼어요.';
  end if;

  insert into public.comments (room_id, artwork_id, author_participant_id, body)
  values (v_art.room_id, v_art.id, v_pid, v_body)
  returning * into v_c;
  return v_c;
end $$;

-- ---------------------------------------------------------------------
-- 6. RPC — 교사용 (모두 "내 수업방인지" 검사)
-- ---------------------------------------------------------------------
create or replace function public.assert_room_teacher(p_room_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_room_teacher(p_room_id) then
    raise exception '이 수업방을 관리할 권한이 없습니다.' using errcode = '42501';
  end if;
end $$;

create or replace function public.create_room(p_title text, p_max_students int default 30)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare
  v_code  text;
  v_room  public.rooms;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 헷갈리는 0,O,1,I 제외
  i int;
begin
  if not public.is_teacher() then raise exception '교사 계정으로 로그인해야 합니다.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_title,''))) < 1 then raise exception '수업 제목을 입력해 주세요.'; end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;
  insert into public.rooms (teacher_id, title, code, max_students)
  values (auth.uid(), trim(p_title), v_code, coalesce(p_max_students, 30))
  returning * into v_room;
  return v_room;
end $$;

create or replace function public.set_room_phase(p_room_id uuid, p_phase text)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare v_room public.rooms;
begin
  perform public.assert_room_teacher(p_room_id);
  if p_phase not in ('drawing','sharing','closed') then raise exception '알 수 없는 단계입니다.'; end if;
  update public.rooms
     set phase = p_phase,
         closed_at = case when p_phase = 'closed' then now() else null end,
         updated_at = now()
   where id = p_room_id returning * into v_room;
  return v_room;
end $$;

create or replace function public.update_room_settings(
  p_room_id uuid,
  p_comments_enabled boolean default null,
  p_allow_resubmit boolean default null,
  p_title text default null,
  p_max_students int default null)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare v_room public.rooms;
begin
  perform public.assert_room_teacher(p_room_id);
  update public.rooms set
    comments_enabled          = coalesce(p_comments_enabled, comments_enabled),
    allow_resubmit_in_sharing = coalesce(p_allow_resubmit, allow_resubmit_in_sharing),
    title                     = coalesce(nullif(trim(p_title), ''), title),
    max_students              = coalesce(p_max_students, max_students),
    updated_at                = now()
  where id = p_room_id returning * into v_room;
  return v_room;
end $$;

create or replace function public.set_artwork_visibility(p_artwork_id uuid, p_visible boolean)
returns public.artworks
language plpgsql security definer set search_path = public as $$
declare v_art public.artworks;
begin
  select * into v_art from public.artworks where id = p_artwork_id;
  if not found then raise exception '작품을 찾을 수 없어요.'; end if;
  perform public.assert_room_teacher(v_art.room_id);
  update public.artworks set is_visible = p_visible where id = p_artwork_id returning * into v_art;
  update public.rooms set moderation_rev = moderation_rev + 1, updated_at = now() where id = v_art.room_id;
  return v_art;
end $$;

create or replace function public.set_all_artworks_visibility(p_room_id uuid, p_visible boolean)
returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform public.assert_room_teacher(p_room_id);
  update public.artworks set is_visible = p_visible where room_id = p_room_id and is_visible <> p_visible;
  get diagnostics v_n = row_count;
  update public.rooms set moderation_rev = moderation_rev + 1, updated_at = now() where id = p_room_id;
  return v_n;
end $$;

create or replace function public.set_comment_hidden(p_comment_id uuid, p_hidden boolean)
returns public.comments
language plpgsql security definer set search_path = public as $$
declare v_c public.comments;
begin
  select * into v_c from public.comments where id = p_comment_id;
  if not found then raise exception '댓글을 찾을 수 없어요.'; end if;
  perform public.assert_room_teacher(v_c.room_id);
  update public.comments set is_hidden = p_hidden where id = p_comment_id returning * into v_c;
  update public.rooms set moderation_rev = moderation_rev + 1, updated_at = now() where id = v_c.room_id;
  return v_c;
end $$;

create or replace function public.delete_comment(p_comment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room uuid;
begin
  select room_id into v_room from public.comments where id = p_comment_id;
  if v_room is null then return; end if;
  perform public.assert_room_teacher(v_room);
  delete from public.comments where id = p_comment_id;
  update public.rooms set moderation_rev = moderation_rev + 1, updated_at = now() where id = v_room;
end $$;

-- 학생이 기기를 바꿨을 때: 번호를 비워 새 기기가 같은 번호로 다시 들어오게 함(작품 유지)
create or replace function public.release_participant(p_participant_id uuid)
returns public.participants
language plpgsql security definer set search_path = public as $$
declare v_p public.participants;
begin
  select * into v_p from public.participants where id = p_participant_id;
  if not found then raise exception '학생을 찾을 수 없어요.'; end if;
  perform public.assert_room_teacher(v_p.room_id);
  update public.participants set user_id = null where id = p_participant_id returning * into v_p;
  return v_p;
end $$;

-- 수업방 삭제 (Storage 파일은 클라이언트가 먼저 Storage API 로 삭제)
create or replace function public.delete_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_room_teacher(p_room_id);
  delete from public.rooms where id = p_room_id;
end $$;

-- 함수 실행 권한: 로그인(익명 포함) 사용자만
do $$
declare f text;
begin
  foreach f in array array[
    'get_room_by_code(text)', 'join_room(text,int,text)', 'submit_artwork(uuid,text,text)',
    'post_comment(uuid,text)', 'create_room(text,int)', 'set_room_phase(uuid,text)',
    'update_room_settings(uuid,boolean,boolean,text,int)', 'set_artwork_visibility(uuid,boolean)',
    'set_all_artworks_visibility(uuid,boolean)', 'set_comment_hidden(uuid,boolean)',
    'delete_comment(uuid)', 'release_participant(uuid)', 'delete_room(uuid)',
    'is_teacher()', 'is_room_teacher(uuid)', 'my_participant_id(uuid)', 'is_room_participant(uuid)',
    'assert_room_teacher(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Storage (비공개 버킷 + 접근 정책)
--    경로 규칙: artworks/{room_id}/{auth.uid()}/{timestamp}-full.jpg | -thumb.jpg
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artworks', 'artworks', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

create or replace function public.safe_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- 업로드 가능: 내 세션 폴더 + 참여 중인 수업방 + 제출 가능한 단계
create or replace function public.can_upload_artwork_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_room uuid := public.safe_uuid(split_part(p_name, '/', 1));
  v_uid  text := split_part(p_name, '/', 2);
  v_r    public.rooms;
begin
  if v_room is null or auth.uid() is null or v_uid <> auth.uid()::text then return false; end if;
  if position('..' in p_name) > 0 then return false; end if;
  select * into v_r from public.rooms where id = v_room;
  if not found then return false; end if;
  if v_r.phase = 'closed' or (v_r.phase = 'sharing' and not v_r.allow_resubmit_in_sharing) then return false; end if;
  return public.is_room_participant(v_room);
end $$;

-- 읽기 가능: 교사(자기 수업방) / 본인 업로드 / 같은 수업방 학생에게 공개된 현재 작품
create or replace function public.can_read_artwork_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_room uuid := public.safe_uuid(split_part(p_name, '/', 1));
begin
  if v_room is null or auth.uid() is null then return false; end if;
  if public.is_room_teacher(v_room) then return true; end if;
  if split_part(p_name, '/', 2) = auth.uid()::text then return true; end if;
  return exists (
    select 1 from public.artworks a
    where a.room_id = v_room
      and (a.image_path = p_name or a.thumb_path = p_name)
      and (a.is_visible or a.participant_id = public.my_participant_id(v_room))
  ) and public.is_room_participant(v_room);
end $$;

revoke all on function public.can_upload_artwork_object(text), public.can_read_artwork_object(text) from public, anon;
grant execute on function public.can_upload_artwork_object(text), public.can_read_artwork_object(text) to authenticated;

drop policy if exists "artworks_insert" on storage.objects;
create policy "artworks_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'artworks' and public.can_upload_artwork_object(name));

drop policy if exists "artworks_select" on storage.objects;
create policy "artworks_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'artworks' and public.can_read_artwork_object(name));

-- 교사만 자기 수업방 파일 삭제 가능 (수업방 삭제 시)
drop policy if exists "artworks_delete_teacher" on storage.objects;
create policy "artworks_delete_teacher" on storage.objects
  for delete to authenticated
  using (bucket_id = 'artworks' and public.is_room_teacher(public.safe_uuid(split_part(name, '/', 1))));
-- (UPDATE 정책 없음 → 기존 파일 덮어쓰기 불가. 재제출은 항상 새 파일 경로로 업로드)

-- ---------------------------------------------------------------------
-- 8. Realtime (테이블 변경 이벤트 발행)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['rooms','participants','artworks','comments'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
