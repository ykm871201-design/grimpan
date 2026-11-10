import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseEnv } from './env';

export async function getServerClient() {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없음 → 미들웨어가 세션을 갱신합니다.
        }
      },
    },
  });
}

/** 서버에서 교사 로그인 여부를 확인합니다. (익명 사용자·미등록 사용자는 거부) */
export async function getTeacherOnServer() {
  const supabase = await getServerClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user || user.is_anonymous) return { supabase, user: null, teacher: null };
  const { data: teacher } = await supabase.from('teachers').select('*').eq('id', user.id).maybeSingle();
  return { supabase, user, teacher };
}
