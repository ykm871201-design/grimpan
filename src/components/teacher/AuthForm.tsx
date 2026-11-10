'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getTeacherClient } from '@/lib/supabase/teacher-client';
import { friendlyError } from '@/lib/errors';

// 서버가 응답하지 않을 때 무한 대기하지 않도록 20초 제한
function withTimeout<T>(p: Promise<T>, ms = 20000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error('TIMEOUT')), ms),
    ),
  ]);
}

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  // 'sending' = 서버에 확인 중, 'moving' = 로그인 성공 후 선생님 화면을 여는 중
  const [busy, setBusy] = useState<false | 'sending' | 'moving'>(false);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (moveTimer.current) clearTimeout(moveTimer.current);
  }, []);
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(
    params.get('error') === 'confirm' ? { kind: 'error', text: '이메일 인증에 실패했어요. 다시 시도해 주세요.' } : null,
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy('sending');
    setMsg(null);
    // 화면 이동이 끝나면 이 컴포넌트는 사라집니다. 성공했을 때는 버튼을 다시 켜지 않고
    // 동그라미를 계속 보여 주되, 만약 이동이 너무 오래 걸리면 다시 누를 수 있게 풀어 줍니다.
    const goTo = (href: string) => {
      setBusy('moving');
      router.replace(href);
      router.refresh();
      moveTimer.current = setTimeout(() => setBusy(false), 20000);
    };
    try {
      const sb = getTeacherClient();
      if (mode === 'login') {
        const { error } = await withTimeout(sb.auth.signInWithPassword({ email, password }));
        if (error) throw error;
        const next = params.get('next');
        goTo(next && next.startsWith('/teacher') ? next : '/teacher');
      } else {
        const { data, error } = await withTimeout(sb.auth.signUp({
          email,
          password,
          options: { data: { display_name: name.trim() || undefined }, emailRedirectTo: `${window.location.origin}/auth/callback` },
        }));
        if (error) throw error;
        if (data.session) {
          goTo('/teacher');
        } else {
          setMsg({ kind: 'info', text: '가입 확인 메일을 보냈어요. 메일함에서 인증 링크를 누른 뒤 로그인해 주세요.' });
          setBusy(false);
        }
      }
    } catch (err) {
      setMsg({ kind: 'error', text: friendlyError(err) });
      setBusy(false);
    }
  };

  const input = 'h-13 w-full rounded-2xl border-2 border-ink-200 bg-ink-50 px-4 py-3 text-lg outline-none focus:border-brand-300 focus:bg-white';
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Link href="/" className="mb-6 text-center text-sm font-semibold text-ink-400 hover:text-ink-600">← 우리반 그림판</Link>
      <div className="rounded-3xl bg-white p-7 shadow-sm ring-1 ring-ink-100">
        <h1 className="mb-1 text-2xl font-extrabold">{mode === 'login' ? '교사 로그인' : '교사 가입'}</h1>
        <p className="mb-6 text-ink-500">{mode === 'login' ? '수업방을 만들고 관리하려면 로그인하세요.' : '이메일과 비밀번호로 교사 계정을 만들어요.'}</p>
        <form onSubmit={submit} className="space-y-3" aria-busy={Boolean(busy)}>
          {mode === 'signup' && <input className={input} placeholder="이름 (예: 양○○ 선생님)" value={name} onChange={(e) => setName(e.target.value)} />}
          <input className={input} type="email" required autoComplete="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} type="password" required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="비밀번호 (6자 이상)" value={password} onChange={(e) => setPassword(e.target.value)} />
          {msg && <div className={`rounded-2xl px-4 py-3 text-sm font-semibold ${msg.kind === 'error' ? 'bg-peach-100 text-peach-700' : 'bg-mint-100 text-mint-700'}`}>{msg.text}</div>}
          <button
            disabled={Boolean(busy)}
            className="inline-flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-brand-500 text-lg font-bold text-white hover:bg-brand-600 disabled:cursor-wait disabled:opacity-80"
          >
            {busy && <span className="h-6 w-6 shrink-0 animate-spin rounded-full border-[3px] border-white/40 border-t-white" aria-hidden="true" />}
            {busy === 'sending'
              ? mode === 'login' ? '로그인하는 중…' : '가입하는 중…'
              : busy === 'moving'
                ? '선생님 화면을 여는 중…'
                : mode === 'login' ? '로그인' : '가입하기'}
          </button>
        </form>
        <div className="mt-5 text-center text-sm text-ink-500">
          {mode === 'login' ? (
            <>처음이신가요? <Link className="font-bold text-brand-600" href="/teacher/signup">교사 가입</Link></>
          ) : (
            <>이미 계정이 있나요? <Link className="font-bold text-brand-600" href="/teacher/login">로그인</Link></>
          )}
        </div>
      </div>
    </main>
  );
}
