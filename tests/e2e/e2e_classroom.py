"""
교실 시나리오 E2E 테스트 (교사 1 + 학생 태블릿 여러 대, 각자 독립된 브라우저 세션)
사전: 1) node tests/e2e/mock-supabase.mjs   2) .env.local 을 mock 주소로 두고 npm run build && npm start
실행: python3 tests/e2e/e2e_classroom.py
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("APP_URL", "http://localhost:3000")
SHOTS = os.environ.get("SHOTS", "/tmp/shots")
os.makedirs(SHOTS, exist_ok=True)
results = []

def check(cond, name):
    results.append(("✅" if cond else "❌") + " " + name)
    print(results[-1], flush=True)

def shot(page, name):
    page.screenshot(path=f"{SHOTS}/{name}.png")

def draw(page, seed=0, strokes=3):
    c = page.locator("canvas.canvas-surface")
    box = c.bounding_box()
    for s in range(strokes):
        x0 = box["x"] + box["width"] * (0.15 + 0.2 * ((s + seed) % 4))
        y0 = box["y"] + box["height"] * (0.2 + 0.15 * s)
        page.mouse.move(x0, y0)
        page.mouse.down()
        for i in range(1, 25):
            page.mouse.move(x0 + i * box["width"] * 0.02, y0 + ((i % 6) - 3) * 8 + i * 3)
        page.mouse.up()

def pick_color(page, idx):
    page.locator('button[aria-label^="색 "]').nth(idx).click()

with sync_playwright() as p:
    chrome = os.environ.get("CHROME_PATH")
    browser = p.chromium.launch(executable_path=chrome, args=["--no-sandbox"]) if chrome else p.chromium.launch()
    tctx = browser.new_context(viewport={"width": 1600, "height": 900}, accept_downloads=True)
    teacher = tctx.new_page()
    teacher.on("pageerror", lambda e: print("TEACHER PAGE ERROR", e))
    teacher.on("response", lambda r: print("TEACHER HTTP", r.status, r.request.method, r.url[:140]) if r.status >= 400 and "54321" in r.url else None)

    # ---------- 1. 교사 가입 + 수업방 생성 ----------
    teacher.goto(f"{BASE}/teacher")
    expect(teacher).to_have_url(re.compile(r"/teacher/login"))
    check(True, "비로그인 교사 페이지 접근 → 로그인 화면으로 이동 (미들웨어)")
    teacher.goto(f"{BASE}/teacher/signup")
    teacher.fill('input[placeholder^="이름"]', "양 선생님")
    teacher.fill('input[type=email]', "teacher@school.kr")
    teacher.fill('input[type=password]', "secret123")
    teacher.click("text=가입하기")
    teacher.wait_for_url(re.compile(r"/teacher$"))
    teacher.fill('input[placeholder^="예: 3학년"]', "3학년 2반 · 우리 동네 봄 풍경")
    teacher.fill('input[type=number]', "8")
    teacher.click("button:has-text('수업방 만들기')")
    teacher.wait_for_url(re.compile(r"/teacher/rooms/"))
    teacher.wait_for_selector("text=학생 접속 QR코드")
    teacher.wait_for_selector('img[alt="QR코드"]')
    code = teacher.locator("div.font-mono.text-7xl").inner_text().strip()
    check(re.fullmatch(r"[A-Z0-9]{6}", code) is not None, f"수업방 생성 + QR코드 표시 (코드 {code})")
    shot(teacher, "01_teacher_qr")
    teacher.keyboard.press("Escape")
    expect(teacher.locator("text=미참여").first).to_be_visible()
    check(teacher.locator("text=미참여").count() == 8, "학생 수 8명 → 빈 칸 8개(미참여) 표시")

    # ---------- 2. 학생 3명 접속 (각자 다른 기기 = 다른 브라우저 컨텍스트) ----------
    students = []
    for n, nick in [(1, "별빛토끼"), (2, "그림왕"), (3, "하늘")]:
        ctx = browser.new_context(viewport={"width": 1180, "height": 820}, has_touch=True, device_scale_factor=2)
        page = ctx.new_page()
        page.on("pageerror", lambda e, n=n: print(f"STUDENT{n} PAGE ERROR", e))
        page.on("response", lambda r, n=n: print(f"STUDENT{n} HTTP", r.status, r.request.method, r.url[:140]) if r.status >= 400 and "54321" in r.url else None)
        page.on("console", lambda m, n=n: print(f"STUDENT{n} CONSOLE", m.text[:200]) if m.type == "error" else None)
        page.goto(f"{BASE}/join/{code}")
        page.wait_for_selector("text=① 내 번호를 눌러요")
        page.locator("section").first.locator(f"button:text-is('{n}')").click()
        page.fill('input[placeholder^="예: 그림왕"]', nick)
        page.click(f"text={n}번 {nick}(으)로 들어가기")
        page.wait_for_selector("text=아직 제출 전")
        students.append({"n": n, "nick": nick, "ctx": ctx, "page": page})
    shot(students[0]["page"], "02_student_drawing_empty")
    teacher.wait_for_selector("text=별빛토끼")
    time.sleep(1.0)
    check(teacher.locator("text=미제출 · 그리는 중").count() == 3, "학생 접속이 교사 화면에 실시간 반영 (3명 '그리는 중')")
    online = teacher.locator("text=/접속 \\d+명/").inner_text()
    check(online == "접속 3명", f"Presence 접속 인원 표시: {online}")

    # 번호 중복 방지
    dctx = browser.new_context(viewport={"width": 1024, "height": 768})
    dup = dctx.new_page()
    dup.goto(f"{BASE}/join/{code}")
    dup.wait_for_selector("text=① 내 번호를 눌러요")
    dup.locator("section").first.locator("button:text-is('1')").click()
    dup.fill('input[placeholder^="예: 그림왕"]', "가짜")
    dup.click("text=1번 가짜(으)로 들어가기")
    dup.wait_for_selector("text=이미 다른 친구가 사용 중")
    check(True, "다른 기기에서 이미 사용 중인 번호로 입장 차단")

    # ---------- 3. 그리기 + 실행취소/다시실행 + 제출 ----------
    s1 = students[0]["page"]
    pick_color(s1, 2)
    draw(s1, 0, 3)
    undo = s1.locator('button[aria-label="실행 취소"]')
    redo = s1.locator('button[aria-label="다시 실행"]')
    undo.click(); undo.click()
    check(redo.is_enabled(), "실행 취소 후 다시 실행 버튼 활성화")
    redo.click()
    s1.locator('button[aria-label="전체 지우기"]').click()
    s1.wait_for_selector("text=그림을 모두 지울까요?")
    s1.click("button:text-is('취소')")
    check(True, "전체 지우기 확인창 표시 + 취소")

    for i, st in enumerate(students):
        pg = st["page"]
        if i:
            pick_color(pg, 4 + i * 3)
            draw(pg, i, 4)
        pg.click("button:has-text('그림 제출')")
        pg.wait_for_selector("text=제출 완료", timeout=15000)
    check(True, "학생 3명 그림 제출 → '제출 완료' 표시")
    shot(s1, "03_student_submitted")

    teacher.wait_for_function("document.querySelectorAll('img[alt$=\"번 작품\"]').length >= 3", timeout=15000)
    check(True, "제출 작품 3개가 교사 갤러리에 실시간 표시")
    sub = teacher.locator("text=/제출 \\d+\\/8/").inner_text().replace("\n", "")
    check("3" in sub, f"제출 수 표시: {sub}")

    # ---------- 4. 같은 학생 3회 제출 (재제출 2번) ----------
    first_src = teacher.locator('img[alt="1번 작품"]').get_attribute("src")
    for k in range(2):
        pick_color(s1, 9 + k)
        draw(s1, 5 + k, 2)
        s1.wait_for_selector("text=고친 내용이 있어요")
        s1.click("button:has-text('다시 제출')")
        try:
            s1.wait_for_selector("text=제출 완료", timeout=15000)
        except Exception:
            shot(s1, "ERR_resubmit"); print("STATUS TEXT:", s1.locator("[role=status]").all_inner_texts()); raise
        time.sleep(0.3)
    teacher.wait_for_selector("text=수정 2회", timeout=15000)
    imgs1 = teacher.locator('img[alt="1번 작품"]').count()
    new_src = teacher.locator('img[alt="1번 작품"]').get_attribute("src")
    check(imgs1 == 1, f"3회 제출해도 1번 작품 칸은 1개 (실제 {imgs1}개)")
    check(new_src != first_src, "재제출 시 이미지 주소 변경 → 캐시된 옛 그림이 남지 않음")
    shot(teacher, "04_teacher_gallery")

    # ---------- 5. 새로고침 복구 (그림·세션) ----------
    s2 = students[1]["page"]
    draw(s2, 2, 1)  # 제출하지 않은 수정
    time.sleep(1.0)  # 자동 임시 저장 대기
    s2.reload()
    s2.wait_for_selector("text=고친 내용이 있어요", timeout=15000)
    check(True, "새로고침 후 같은 학생 세션 + 제출 안 한 수정본까지 복구")

    # ---------- 6. 숨김 ----------
    teacher.locator('img[alt="2번 작품"]').click()
    teacher.click("text=학생들에게 숨기기")
    try:
        teacher.wait_for_selector("text=숨김 상태", timeout=8000)
    except Exception:
        shot(teacher, "ERR_hide"); raise
    teacher.keyboard.press("Escape")
    check(teacher.locator("span:text-is('숨김')").count() >= 1, "교사 화면에 숨김 상태 명확히 표시")

    # ---------- 7. 인터넷 끊김 ----------
    s3 = students[2]["page"]
    students[2]["ctx"].set_offline(True)
    s3.wait_for_selector("text=인터넷 연결이 끊겼어요", timeout=15000)
    check(True, "인터넷 끊김 → 학생 화면에 연결 상태 안내")
    shot(s3, "05_student_offline")

    # ---------- 8. 느낌 나누기 시작 (오프라인 학생은 재연결 후 반영) ----------
    teacher.click("text=느낌 나누기 시작")
    for st in students[:2]:
        st["page"].wait_for_selector("text=친구들의 그림을 감상해 봅시다!", timeout=10000)
    shot(s1, "06_student_transition")
    check(True, "교사 버튼 하나로 접속 학생 화면 자동 전환 + 안내 문구")
    s1.wait_for_selector("text=친구들의 작품", timeout=10000)
    shot(s1, "07_student_board")
    students[2]["ctx"].set_offline(False)
    s3.wait_for_selector("text=친구들의 작품", timeout=30000)
    check(True, "끊겼던 학생도 재연결 후 최신 단계(감상 게시판)로 복구")

    # 숨긴 2번 작품이 학생에게 안 보이는지
    time.sleep(1)
    vis3 = s3.locator('img[alt="2번 작품"]').count()
    vis_own = s2.locator('img[alt="2번 작품"]').count()
    check(vis3 == 0, f"숨긴 작품은 다른 학생 게시판에 안 보임 ({vis3})")
    check(vis_own == 1 and s2.locator("text=선생님이 잠시 숨겼어요").count() == 1, "숨긴 작품도 본인에게는 '숨김' 안내와 함께 보임")

    # 늦게 들어온 학생
    lctx = browser.new_context(viewport={"width": 820, "height": 1180}, has_touch=True)
    late = lctx.new_page()
    late.goto(f"{BASE}/join/{code}")
    late.wait_for_selector("text=① 내 번호를 눌러요")
    late.locator("section").first.locator("button:text-is('5')").click()
    late.fill('input[placeholder^="예: 그림왕"]', "늦은별")
    late.click("text=5번 늦은별(으)로 들어가기")
    late.wait_for_selector("text=친구들의 작품", timeout=15000)
    check(True, "늦게 접속한 학생은 바로 현재 단계(감상 게시판) 화면")
    shot(late, "08_late_student_portrait")

    # ---------- 9. 댓글 ----------
    s3.locator('img[alt="1번 작품"]').click()
    s3.wait_for_selector("text=별빛토끼의 작품")
    s3.click("text=👏 칭찬")
    s3.keyboard.type("색깔이 정말 예뻐요!")
    s3.click("button:has-text('등록')")
    s3.wait_for_selector("text=칭찬하고 싶은 부분은 색깔이 정말 예뻐요!")
    check(s3.locator("text=/\\d초/").count() == 1, "댓글 등록 후 3초 연속 등록 방지(카운트다운)")
    shot(s3, "09_student_comment")
    late.locator('img[alt="1번 작품"]').click()
    late.wait_for_selector("text=칭찬하고 싶은 부분은 색깔이 정말 예뻐요!", timeout=10000)
    check(True, "다른 학생 화면에 댓글 실시간 표시 (새로고침 없이)")
    late.fill("textarea", "이 그림을 보니 봄 소풍이 생각나요")
    late.keyboard.press("Enter")
    s1.wait_for_selector("text=/💬|친구들의 작품/")
    teacher.wait_for_selector("text=이 그림을 보니 봄 소풍이 생각나요", timeout=10000)
    feed_txt = teacher.locator("aside").inner_text()
    check("3번 하늘" in feed_txt and "1번 별빛토끼 작품" in feed_txt, "교사 중계창: [작성자 → 대상 작품] + 내용 + 시각")
    order = feed_txt.find("봄 소풍") < feed_txt.find("정말 예뻐요")
    check(order, "중계창 최신 댓글이 위에")
    # 3번 작품에 남긴 댓글이 다른 작품에 섞이지 않는지
    late.click('button[aria-label="다음 작품"]')
    time.sleep(0.5)
    check(late.locator("text=봄 소풍").count() == 0, "작품별 댓글 분리 (다른 작품 상세에는 안 보임)")
    # 자기 작품 댓글 차단 안내
    try:
        s1.locator('img[alt="1번 작품"]').click(timeout=10000)
    except Exception:
        shot(s1, "ERR_s1_board"); raise
    s1.wait_for_selector("text=내 작품에 친구들이 남긴 댓글을 읽어 보세요!")
    check(True, "자기 작품에는 댓글 입력창 대신 안내")
    shot(teacher, "10_teacher_feed")

    # ---------- 10. 교사 댓글 숨김 / 댓글 중단 ----------
    item = teacher.locator("aside div.group", has_text="정말 예뻐요").first
    item.hover()
    item.locator("button:has-text('숨기기')").click()
    late.click('button[aria-label="이전 작품"]')
    late.wait_for_selector("text=정말 예뻐요", state="detached", timeout=10000)
    check(True, "교사가 숨긴 댓글이 학생 화면에서 즉시 사라짐")
    teacher.locator("aside button[role=switch]").click()
    late.wait_for_selector("text=선생님이 댓글 쓰기를 잠시 멈췄어요.", timeout=10000)
    check(True, "교사 댓글 중단 → 학생 입력창 즉시 비활성화")
    teacher.locator("aside button[role=switch]").click()

    # 중계 모드 / 협동화 / 전체 화면
    teacher.click('button[title="중계 모드(크게 보기)"]')
    shot(teacher, "11_teacher_relay_mode")
    teacher.click('button[title="기본 화면"]')
    teacher.click("text=협동화 보기")
    shot(teacher, "12_teacher_mosaic")
    teacher.click("text=협동화 보기")

    # ---------- 11. 결과 저장 ----------
    teacher.click("text=결과 저장")
    with teacher.expect_download() as d:
        teacher.click("text=작품별 댓글 목록 (CSV)")
    csv = open(d.value.path(), encoding="utf-8-sig").read()
    check("봄 소풍" in csv and "작성자 별명" in csv, "댓글 CSV 다운로드 (한글 BOM)")
    with teacher.expect_download() as d:
        teacher.click("text=전체 그림 ZIP")
    zsize = os.path.getsize(d.value.path())
    check(zsize > 10000, f"전체 그림 ZIP 다운로드 ({zsize//1024}KB)")
    with teacher.expect_download() as d:
        teacher.click("text=협동화 한 장으로 합치기")
    d.value.save_as(f"{SHOTS}/collage.jpg")
    check(os.path.getsize(f"{SHOTS}/collage.jpg") > 10000, "협동화 이미지 합치기 다운로드")
    teacher.keyboard.press("Escape")

    # ---------- 12. 활동 마무리 ----------
    teacher.click("text=활동 마무리")
    teacher.click("text=마무리하기")
    late.click("text=목록으로")
    late.wait_for_selector("text=오늘 활동이 끝났어요", timeout=10000)
    check(True, "활동 마무리 → 학생 화면 읽기 전용 + 안내")
    late.locator('img[alt="2번 작품"], img[alt="1번 작품"]').first.click()
    late.wait_for_selector("text=활동이 끝나서 댓글을 쓸 수 없어요.")
    check(True, "마무리 후 댓글 작성 불가")

    # ---------- 13. 다른 수업방과 섞이지 않음 ----------
    teacher.goto(f"{BASE}/teacher")
    teacher.fill('input[placeholder^="예: 3학년"]', "다른 반 수업")
    teacher.click("button:has-text('수업방 만들기')")
    teacher.wait_for_url(re.compile(r"/teacher/rooms/"))
    teacher.keyboard.press("Escape")
    time.sleep(1.5)
    check(teacher.locator('img[alt$="번 작품"]').count() == 0 and teacher.locator("text=별빛토끼").count() == 0, "새 수업방에는 이전 수업 그림·학생이 섞이지 않음")
    teacher.goto(f"{BASE}/teacher")
    teacher.wait_for_selector("text=결과 보기")
    check(True, "마무리된 수업은 대시보드에서 다시 열람 가능")
    shot(teacher, "13_teacher_dashboard")

    browser.close()

fails = [r for r in results if r.startswith("❌")]
print(f"\n총 {len(results)}개 중 {len(results) - len(fails)}개 통과")
sys.exit(1 if fails else 0)
