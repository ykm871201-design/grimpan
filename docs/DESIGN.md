# 우리반 그림판 — 전체 구조 설계

## 1. 화면 구성과 이동

| 주소 | 대상 | 화면 |
|---|---|---|
| `/` | 공통 | 첫 화면 (학생: 코드 입력 / 교사: 로그인·가입) |
| `/join` | 학생 | 6글자 수업 코드 입력 |
| `/join/{코드}` | 학생 | **QR코드가 가리키는 주소.** 자동 익명 접속 → 번호·별명 입력 → 수업 단계에 맞는 화면 |
| `/teacher/login`, `/teacher/signup` | 교사 | 이메일·비밀번호 로그인/가입 |
| `/teacher` | 교사 | 대시보드: 수업방 만들기, 지난 수업 목록(다시 열람·삭제) |
| `/teacher/rooms/{id}` | 교사 | **수업 진행 화면**: 단계 제어 · 작품 갤러리(70~75%) · 실시간 댓글 중계(25~30%) |

학생 화면은 수업방의 `phase` 값에 따라 자동으로 바뀝니다.

```
phase = drawing  → 그림판 (DrawingBoard)
phase = sharing  → 전환 애니메이션 "친구들의 그림을 감상해 봅시다!" → 감상 게시판 (SharingBoard) → 작품 상세 + 댓글 (ArtworkDetail)
                   (교사가 '감상 중 그림 수정 허용'을 켜면 게시판에 '내 그림 고치기' 버튼)
phase = closed   → 읽기 전용 게시판 + "활동이 끝났어요"
```

교사 화면의 보조 창: QR코드 크게 보기(`QrModal`), 수업방 관리(`ManageModal`), 결과 저장(`ResultsModal`), 작품 크게 보기(`ArtworkModal`).
보기 전환: 모든 학생/제출 작품만, 협동화 보기(간격 없는 모자이크), 갤러리 크게(댓글창 접기), 중계 모드(댓글창 전체 화면), 전자칠판 전체 화면.

## 2. 데이터베이스

```
auth.users ─┬─< teachers (교사 계정, 이메일 가입 시 트리거로 자동 생성)
            │        └─< rooms (수업방: 제목, 6자리 코드, 학생 수, phase, 댓글 허용, 감상 중 재제출 허용, moderation_rev)
            │                 ├─< participants (학생: 출석번호, 별명, user_id=익명 세션)   UNIQUE(room_id, student_number), UNIQUE(room_id, user_id)
            │                 │        └── artworks (작품: 학생당 1개)                   UNIQUE(participant_id)  ← 재제출은 UPDATE
            │                 │               ├─< artwork_versions (제출 이력, 교사만 열람)
            │                 │               └─< comments (작품별 댓글, is_hidden)
            └── (익명 학생 세션)
storage: artworks 버킷 (비공개)  경로 = {room_id}/{학생 세션 uid}/{시각}-full.jpg | -thumb.jpg
```

- **학생 1명 = 작품 1개**: `artworks.participant_id` 가 UNIQUE 이고, 제출 RPC 가 `INSERT … ON CONFLICT (participant_id) DO UPDATE` 로 최신 이미지로 교체합니다. 버전 번호가 올라가고, 이전 파일 경로는 `artwork_versions` 에 남습니다.
- **캐시 문제 방지**: 재제출마다 새 파일 경로로 올리므로 브라우저가 옛 이미지를 보여줄 수 없습니다. (같은 경로 덮어쓰기 자체를 Storage 정책에서 금지)
- **실명 불필요**: 학생 정보는 출석번호와 별명뿐입니다.

## 3. 권한 체계

| 동작 | 누가 | 어디서 검사 |
|---|---|---|
| 읽기 (수업방·학생·작품·댓글) | 그 수업방의 교사 / 그 수업방 참여 학생 | RLS `SELECT` 정책 |
| 숨긴 작품·숨긴 댓글 읽기 | 교사(학생은 자기 작품만) | RLS |
| 테이블 직접 쓰기 | **아무도 불가** (`authenticated` 역할에 SELECT 권한만 부여) | GRANT |
| 참여·제출·댓글 | 학생 본인 | `join_room`, `submit_artwork`, `post_comment` (security definer RPC 가 단계·소유·길이·연속등록 검사) |
| 단계 전환, 공개/숨김, 댓글 숨김/삭제/중단, 번호 재설정, 수업방 삭제 | 그 수업방 교사만 | 교사용 RPC 안의 `assert_room_teacher()` |
| 그림 파일 업로드 | 학생 본인 폴더 + 참여 중 + 제출 가능한 단계 | Storage `INSERT` 정책 |
| 그림 파일 보기 | 교사 / 본인 / 같은 반 학생(공개된 현재 작품만) | Storage `SELECT` 정책 → 서명 URL |

교사 페이지는 ① 미들웨어 ② 서버 컴포넌트에서도 로그인을 확인하지만, 실제 보호는 ③ DB 의 RLS·RPC 입니다. 화면 버튼을 숨기는 것으로 보호하지 않습니다. 클라이언트에는 공개 가능한 anon 키만 있고 service_role 키는 쓰지 않습니다.

## 4. 실시간 데이터 흐름

```
학생 태블릿 ──RPC/Storage──▶ Supabase Postgres ──(publication supabase_realtime)──▶ Realtime ──▶ 교사·학생 브라우저
                                     │                                              (구독자마다 RLS 검사 후 전달)
                                     └── rooms.moderation_rev 증가 (교사가 숨김/삭제할 때)
```

- 모든 화면은 `useRoomData` 훅 하나로 `rooms / participants / artworks / comments` 를 불러오고, 채널 `room:{id}` 에서 `postgres_changes` 를 구독합니다.
- **접속 인원**은 같은 채널의 Presence 로 셉니다.
- **숨김 처리 동기화**: 행이 숨겨지면 RLS 때문에 학생은 그 변경 이벤트를 받지 못합니다. 그래서 교사용 RPC 가 `rooms.moderation_rev` 를 올리고, 학생 화면은 이 값이 바뀌면 목록을 다시 불러옵니다(무작위 0~0.4초 지연으로 동시 요청 분산).
- **끊김 복구**: 채널이 다시 연결될 때(`SUBSCRIBED`), 브라우저가 온라인으로 돌아올 때, 태블릿 화면이 다시 켜질 때 전체 데이터를 다시 불러옵니다. 30초마다 채널 상태도 점검합니다. 끊긴 동안 화면 상단에 안내가 표시됩니다.
- **이미지**: 비공개 버킷이므로 6시간짜리 서명 URL 을 한 번에 여러 개 발급받아 캐시합니다. 갤러리와 게시판은 480×360 썸네일(약 20~40KB), 크게 보기만 1600×1200 원본(JPEG)을 씁니다.

## 5. 그림판

- 모든 획을 **논리 좌표 1600×1200(4:3)** 의 벡터로 저장 → 화면 크기 × `devicePixelRatio` 해상도로 다시 그려 레티나·고해상도 태블릿에서도 선명합니다.
- Pointer Events + `setPointerCapture` + `getCoalescedEvents`(빠른 펜 움직임도 부드럽게), 캔버스에 `touch-action: none` 과 iOS 터치 기본동작 차단 → 스크롤·확대·길게 누르기와 충돌하지 않습니다.
- 손바닥 거치 방지: 스타일러스가 한 번 감지되면 손가락 터치는 그리기에서 제외합니다. 두 번째 손가락은 무시합니다.
- 실행 취소/다시 실행: 획 단위. '전체 지우기'도 하나의 동작이라 실행 취소로 되돌릴 수 있습니다.
- 임시 자동 저장: 0.6초마다 IndexedDB 에 저장(획 + 배경). 새로고침해도 같은 기기에서 복구됩니다. 다른 기기로 바꾼 경우(교사의 '번호 재설정' 후)에는 서버에 제출된 그림을 배경으로 불러와 이어 그립니다.

## 6. 주요 파일

```
supabase/schema.sql                  DB·RLS·RPC·Storage·Realtime 설정 (SQL Editor 에 그대로 실행)
src/lib/useRoomData.ts               실시간 동기화 + 재연결 복구
src/lib/signedUrls.ts                서명 URL 캐시
src/lib/results.ts                   ZIP / 협동화 이미지 / CSV
src/components/drawing/              그림판 (engine.ts = 순수 그리기 로직)
src/components/student/              학생 화면 (입장, 게시판, 상세·댓글, 전환 애니메이션)
src/components/teacher/              교사 화면 (갤러리, 댓글 중계, QR, 관리, 결과)
src/middleware.ts                    교사 페이지 로그인 확인
supabase/tests/db.test.mjs           DB 권한·로직 자동 테스트 (51개)
tests/e2e/                           가짜 Supabase + 브라우저 교실 시나리오 테스트 (41개)
scripts/load-test.mjs                동시 접속 부하 테스트 (실제 Supabase 에도 실행 가능)
```
