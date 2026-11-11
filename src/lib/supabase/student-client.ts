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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errText(e: unknown) {
  if (!e || typeof e !== 'object') return String(e ?? '').toLowerCase();
  const o = e as { message?: unknown; code?: unknown; status?: unknown };
  return `${o.message ?? ''} ${o.code ?? ''} ${o.status ?? ''}`.toLowerCase();
}

/** 같은 학교 인터넷(같은 IP)에서 접속이 몰려 Supabase 횟수 제한에 걸렸거나, 잠깐 인터넷이 끊긴 경우 */
function isTemporary(e: unknown) {
  const m = errText(e);
  return /rate limit|too many|429|over_request|fetch|network|timeout|load failed|50[234]/.test(m);
}

/**
 * 요청이 '로그인 안 한 사람'으로 처리되어 난 오류인지.
 * supabase-js 는 세션이 사라지면 경고 없이 공개 키만으로 요청을 보내므로 DB 함수에서
 * 'permission denied for function …' 이 납니다.
 */
export function isSessionLost(e: unknown) {
  const m = errText(e);
  return m.includes('permission denied for function') || m.includes('jwt expired') || m.includes('invalid jwt') || m.includes('세션이 없습니다');
}

/**
 * 로그인 화면 없이 익명 세션을 자동으로 확보합니다.
 * 접속이 몰려 거절되면 학생마다 조금씩 다른 시간만큼 기다렸다가 다시 시도합니다(최대 6번).
 * onWait(n): n번째 다시 시도를 기다리는 중일 때 호출 (화면 안내용)
 * force: 저장된 세션이 있어도 새 익명 세션으로 바꿈 (세션이 서버에서 통하지 않을 때)
 */
export async function ensureStudentSession(sb: SupabaseClient, onWait?: (n: number) => void, force = false): Promise<string> {
  if (!force) {
    const { data } = await sb.auth.getSession();
    if (data.session?.user) return data.session.user.id;
  }
  let last: unknown = null;
  for (let i = 0; i < 6; i++) {
    const { data: signed, error } = await sb.auth.signInAnonymously();
    if (!error && signed.user) return signed.user.id;
    last = error ?? new Error('세션을 만들지 못했어요.');
    if (!isTemporary(last) || i === 5) break;
    onWait?.(i + 1);
    await sleep(1500 * (i + 1) + Math.random() * 2500);
  }
  throw last;
}

/**
 * 세션을 확인한 뒤 DB 함수를 부르고, 세션이 사라져서 거절되면 세션을 다시 만들어 한 번 더 시도합니다.
 * (수업방 입장 전 단계에서만 사용: 이 단계에서는 세션이 바뀌어도 잃을 것이 없음)
 */
export async function rpcWithSession<T>(
  sb: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  onWait?: (n: number) => void,
): Promise<T> {
  await ensureStudentSession(sb, onWait);
  let r = await sb.rpc(fn, args);
  if (r.error && isSessionLost(r.error)) {
    await ensureStudentSession(sb, onWait, true);
    r = await sb.rpc(fn, args);
  }
  if (r.error) throw r.error;
  return r.data as T;
}
