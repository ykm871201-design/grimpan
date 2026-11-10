import { NextResponse, type NextRequest } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';

// 이메일 인증 링크를 누르면 이곳으로 돌아와 세션을 만듭니다.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  if (code) {
    const supabase = await getServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/teacher`);
  }
  return NextResponse.redirect(`${origin}/teacher/login?error=confirm`);
}
