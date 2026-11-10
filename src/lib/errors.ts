export function friendlyError(e: unknown): string {
  const raw =
    typeof e === 'string'
      ? e
      : e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : '알 수 없는 오류가 발생했어요.';
  const m = raw.toLowerCase();
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed'))
    return '인터넷 연결이 불안정해요. 잠시 후 다시 시도해 주세요.';
  if (m.includes('anonymous sign-ins are disabled'))
    return '학생 자동 접속(익명 로그인)이 꺼져 있어요. 선생님께 알려 주세요. (Supabase > Authentication > Sign In / Providers > Anonymous)';
  if (m.includes('rate limit') || m.includes('too many') || m.includes('429'))
    return '접속이 한꺼번에 몰렸어요. 10초 뒤에 다시 시도해 주세요.';
  if (m.includes('row-level security') || m.includes('unauthorized') || m.includes('403'))
    return '지금은 이 작업을 할 수 없어요. (감상 시간이거나 수업이 끝났을 수 있어요)';
  if (m.includes('invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (m.includes('email not confirmed')) return '이메일 인증이 아직 안 되었어요. 메일함의 인증 링크를 눌러 주세요.';
  if (m.includes('user already registered')) return '이미 가입된 이메일이에요. 로그인해 주세요.';
  if (m.includes('password should be')) return '비밀번호는 6자 이상이어야 해요.';
  if (m.includes('jwt expired')) return '접속이 만료되었어요. 페이지를 새로고침해 주세요.';
  return raw;
}

export async function withRetry<T>(fn: () => Promise<T>, tries = 3, baseMs = 700): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String((e as { message?: string })?.message ?? e).toLowerCase();
      const transient =
        msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') ||
        msg.includes('load failed') || msg.includes('502') || msg.includes('503') || msg.includes('504');
      if (!transient || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, baseMs * (i + 1) + Math.random() * 400));
    }
  }
  throw last;
}
