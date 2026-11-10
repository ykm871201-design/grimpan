'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseEnv } from './env';

// 교사용: 쿠키 기반 세션 (서버 컴포넌트·미들웨어에서도 로그인 확인 가능)
let client: SupabaseClient | null = null;
export function getTeacherClient(): SupabaseClient {
  if (!client) {
    const { url, key } = getSupabaseEnv();
    client = createBrowserClient(url, key, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}
