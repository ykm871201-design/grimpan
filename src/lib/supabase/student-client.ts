'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseEnv } from './env';

// 학생용: 익명 세션을 이 기기의 localStorage 에 별도 키로 저장합니다.
// (같은 브라우저에서 교사 로그인과 섞이지 않도록 storageKey 를 분리)
let client: SupabaseClient | null = null;
export function getStudentClient(): SupabaseClient {
  if (!client) {
    const { url, key } = getSupabaseEnv();
    client = createClient(url, key, {
      auth: {
        storageKey: 'gurimpan-student-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}

/** 로그인 화면 없이 익명 세션을 자동으로 확보합니다. */
export async function ensureStudentSession(sb: SupabaseClient): Promise<string> {
  const { data } = await sb.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  const { data: signed, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  if (!signed.user) throw new Error('세션을 만들지 못했어요.');
  return signed.user.id;
}
