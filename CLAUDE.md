# 우리반 그림판 (grimpan) — Claude Code 작업 안내

초등학교 교실용 실시간 협동 그림판 + 작품 감상 웹앱. 교사 1명 + 학생 20~35명(태블릿)이 동시에 사용한다.
전체 기능·배포 가이드는 `README.md`, 구조 설계는 `docs/DESIGN.md` 를 먼저 읽을 것.

## 사용자
- 초등학교 교사(정보부장). 개발 초보이며 Supabase·Vercel·GitHub 를 이번에 처음 설정했다.
- **설명은 한국어로, 클릭할 메뉴 이름까지 단계별로.** 명령어나 설정값은 복사할 수 있게 코드 블록으로 준다.
- 앱의 모든 UI 문구는 한국어, 초등학생이 읽기 쉬운 말투.

## 현재 운영 상태 (2026-11-10 기준)
- 배포 주소: https://grimpan.vercel.app (Vercel Hobby, GitHub `main` 에 push 하면 자동 배포)
- Supabase 프로젝트: `iowvavlcyemnlmvmjkbt` (Seoul, Free 요금제). `supabase/schema.sql` 설치 완료.
- Vercel 환경변수 (**반드시 Type = Config**. Secret 이면 브라우저 번들에 들어가지 않아 앱이 멈춘다):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` ← Supabase publishable 키(`sb_publishable_…`). 공개되어도 되는 키다.
  - 환경변수를 바꾸면 **Deployments → Redeploy** 해야 반영된다.
- Supabase Auth 설정 (확인 완료): 익명 로그인 ON, Email provider ON, Confirm email OFF, 신규 가입 허용.
- 아직 안 한 것: 익명 로그인 Rate limit 상향(기본 IP당 시간당 30회 → 300 이상 필요, 교실 전체가 같은 공인 IP), 실제 태블릿 여러 대 접속 테스트(README 3-9 체크리스트).
- GitHub 저장소가 **public** 이다. 비밀값은 저장소에 없지만, 사용자가 원하면 private 전환을 안내.

## 기술 스택
Next.js 15.5 (App Router, `src/`) · React 19 · TypeScript strict · Tailwind CSS 4 (`src/app/globals.css` 의 `@theme` 에 색상 정의: ink/brand/mint/peach/butter) · Supabase (Postgres + RLS, Realtime postgres_changes + Presence, 비공개 Storage 버킷 `artworks`, Auth 익명/이메일) · idb-keyval(그림 임시 저장) · jszip · qrcode

## 반드시 지킬 설계 원칙
- **클라이언트는 테이블을 SELECT 만 한다.** 모든 쓰기는 `supabase/schema.sql` 의 `security definer` RPC 로만 하고, RPC 안에서 권한(교사 본인 수업방 / 참여 학생 본인)과 수업 단계를 검사한다. 새 쓰기 기능도 같은 방식으로 추가할 것. 화면에서 버튼을 숨기는 것으로 보호하지 않는다.
- `service_role` 키는 쓰지 않는다. 서버 API 라우트에서도 사용자 세션으로 호출한다.
- 학생 = Supabase 익명 사용자(`is_anonymous`), 교사 = 이메일 가입자(`public.teachers` 에 트리거로 자동 등록).
- 학생 1명 = 수업방당 작품 1개 (`artworks.participant_id` UNIQUE, 재제출은 upsert). 재제출 이미지는 항상 **새 경로**로 업로드한다(캐시 방지, Storage UPDATE 정책 없음).
- 숨김/삭제처럼 학생이 RLS 때문에 변경 이벤트를 못 받는 동작은 RPC 에서 `rooms.moderation_rev` 를 올려 학생 화면이 다시 불러오게 한다.
- 실시간 동기화는 `src/lib/useRoomData.ts` 한 곳에서 처리한다(재연결·온라인 복귀·화면 복귀 시 전체 재조회).
- 학생 클라이언트(`src/lib/supabase/student-client.ts`, localStorage 별도 키)와 교사 클라이언트(`teacher-client.ts`, 쿠키 기반 @supabase/ssr)는 분리되어 있다. 섞지 말 것.
- 실명 수집 금지(출석번호 + 별명만).

## DB 변경 방법
1. `supabase/schema.sql` 을 수정한다(여러 번 실행해도 안전하게: `create or replace`, `if not exists`, `drop policy if exists`).
2. `npm run test:db` 로 검증한다(PGlite 로 실제 SQL·RLS 실행). 새 로직에는 테스트를 추가한다.
3. 사용자에게 Supabase **SQL Editor** 에 schema.sql 전체를 붙여넣고 Run 하도록 안내한다(자동 마이그레이션 도구 없음).

## 명령어
```bash
npm install
cp .env.example .env.local   # 값 입력 (로컬 개발 시)
npm run dev                  # http://localhost:3000
npm run typecheck
npm run build
npm run test:db              # DB 권한·로직 테스트 (51개)
tests/e2e/run.sh             # 가짜 Supabase + 브라우저 교실 시나리오 (42개). Python playwright 필요, CHROME_PATH 로 크롬 지정 가능
npm run load-test            # 동시 접속 부하 테스트 (환경변수는 scripts/load-test.mjs 상단 참고, 실제 Supabase 에도 실행 가능)
```
`tests/e2e/mock-supabase.mjs` 는 실제 schema.sql 을 PGlite 에 올리고 Auth/REST/Storage/Realtime 을 흉내 내는 **테스트 전용** 서버다. 클라이언트가 새 Supabase API 를 쓰면 이 mock 에도 해당 엔드포인트를 추가해야 E2E 가 돈다.

## 변경 후 배포
코드 수정 → `npm run typecheck && npm run build && npm run test:db` 통과 확인 → 커밋 → `main` 에 push → Vercel 자동 배포(1~2분). DB 변경이 있으면 SQL Editor 실행 안내를 함께 한다.

## 배포 중 겪은 문제 (재발 시 참고)
| 증상 | 원인 | 해결 |
|---|---|---|
| Vercel 에 Key 칸에 URL 을 넣어 오류 | 칸 혼동 | Key = 변수 이름, Value = 값 |
| 교사 가입 '잠시만요…'에서 멈춤 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` 가 Secret 타입이라 번들에 빠짐 → 클라이언트 생성 예외가 try 밖에서 발생 | Config 로 다시 만들고 Redeploy. (AuthForm 은 이제 try 안에서 생성 + 20초 타임아웃) |
| 이메일 가입 불가 | Supabase Email provider 가 꺼져 있었음 | Sign In / Providers → Email ON, Confirm email OFF |
| 여러 명 동시 입장 시 학생 화면에 `permission denied for function join_room` | 같은 공인 IP 에서 접속이 몰려 Auth 횟수 제한(429) → 세션이 사라지면 supabase-js 가 경고 없이 공개 키로 요청 → DB 함수 권한 없음 | 클라이언트: `rpcWithSession`/`ensureStudentSession` 이 세션 재확보 + 429 시 분산 재시도(2026-11-11). 대시보드: Authentication → Rate Limits 상향 |

배포된 번들에 환경변수가 들어갔는지는 사이트 JS 에서 `supabase.co` / `sb_publishable_` 문자열을 찾아 확인할 수 있다. 설정 상태는 `GET https://<ref>.supabase.co/auth/v1/settings` (헤더 `apikey`) 로 확인한다.

## 앞으로 할 일 후보
- 실제 iPad / 갤럭시탭에서 터치·펜 필기감, 전자칠판 전체 화면 확인
- 익명 로그인 Rate limit 상향 확인
- 사용자 요청 시: 댓글 금칙어 필터, 수업 템플릿(주제 안내 문구), 학생 자기 작품 설명 쓰기, 교사 여러 명 공동 관리 등
