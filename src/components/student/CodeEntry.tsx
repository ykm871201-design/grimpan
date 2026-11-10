'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CodeEntry({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean.length === 6) router.push(`/join/${clean}`);
      }}
    >
      <input
        value={clean}
        onChange={(e) => setCode(e.target.value)}
        autoFocus={autoFocus}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="예: AB12CD"
        aria-label="수업 코드"
        className="h-14 min-w-0 flex-1 rounded-2xl border-2 border-ink-200 bg-ink-50 px-4 text-center font-mono text-2xl font-bold tracking-[0.3em] outline-none focus:border-mint-400 focus:bg-white"
      />
      <button
        disabled={clean.length !== 6}
        className="h-14 rounded-2xl bg-mint-500 px-6 text-lg font-bold text-white disabled:opacity-40"
      >
        입장
      </button>
    </form>
  );
}
