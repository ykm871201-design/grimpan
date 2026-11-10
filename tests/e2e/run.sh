#!/usr/bin/env bash
# 가짜 Supabase + 앱을 띄우고 교실 시나리오 E2E 테스트를 실행합니다. (개발자용)
# 필요: Node 20+, Python 3 + playwright (pip install playwright && playwright install chromium)
set -e
(fuser -k 3000/tcp 54321/tcp 2>/dev/null || true)
cd "$(dirname "$0")/../.."
ANON=$(node -e "const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');console.log(b({alg:'HS256',typ:'JWT'})+'.'+b({role:'anon'})+'.mock')")
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON NEXT_TELEMETRY_DISABLED=1
node tests/e2e/mock-supabase.mjs & MOCK=$!
npx next build && (npx next start -p 3000 & echo $! > /tmp/gurimpan-next.pid)
sleep 4
python3 tests/e2e/e2e_classroom.py; CODE=$?
kill $MOCK 2>/dev/null; pkill -f next-server 2>/dev/null; kill $(cat /tmp/gurimpan-next.pid) 2>/dev/null || true
exit $CODE
