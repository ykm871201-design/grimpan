import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// 교사 페이지 접근 시 세션 쿠키를 갱신하고, 로그인하지 않았으면 로그인 화면으로 보냅니다.
// (실제 권한은 DB 의 RLS·RPC 검사로 한 번 더 보호됩니다)
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isAuthPage = path.startsWith('/teacher/login') || path.startsWith('/teacher/signup');
  const isTeacher = data.user && !data.user.is_anonymous;

  if (!isAuthPage && !isTeacher) {
    const to = request.nextUrl.clone();
    to.pathname = '/teacher/login';
    to.searchParams.set('next', path);
    return NextResponse.redirect(to);
  }
  if (isAuthPage && isTeacher) {
    const to = request.nextUrl.clone();
    to.pathname = '/teacher';
    to.search = '';
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ['/teacher/:path*'],
};
