'use client';
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Participant, RoomBasic } from '@/lib/types';
import { friendlyError } from '@/lib/errors';

const LAST_KEY = 'gurimpan-last-identity';

export function JoinForm({ sb, code, room, onJoined }: { sb: SupabaseClient; code: string; room: RoomBasic; onJoined: (p: Participant) => void }) {
  const [num, setNum] = useState<number | null>(null);
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
      if (last?.nickname) setNick(last.nickname);
      if (last?.number && last.number <= room.max_students) setNum(last.number);
    } catch {
      /* noop */
    }
  }, [room.max_students]);

  const submit = async () => {
    if (!num || !nick.trim()) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await sb.rpc('join_room', { p_code: code, p_student_number: num, p_nickname: nick.trim() });
    setBusy(false);
    if (error) {
      setErr(friendlyError(error));
      return;
    }
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ number: num, nickname: nick.trim() }));
    } catch {
      /* noop */
    }
    onJoined(data as Participant);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 py-6">
      <div className="mb-5 text-center animate-rise">
        <div className="text-sm font-bold text-mint-600">수업방 입장</div>
        <h1 className="mt-1 text-3xl font-extrabold text-ink-800">{room.title}</h1>
      </div>

      <section className="mb-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink-100">
        <h2 className="mb-3 text-xl font-bold">① 내 번호를 눌러요</h2>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 md:grid-cols-10">
          {Array.from({ length: room.max_students }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => setNum(n)}
              className={`aspect-square rounded-2xl text-xl font-bold transition active:scale-95 ${
                num === n ? 'bg-mint-500 text-white shadow-md shadow-mint-500/30' : 'bg-ink-50 text-ink-700 ring-1 ring-ink-200'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink-100">
        <h2 className="mb-1 text-xl font-bold">② 별명을 써요</h2>
        <p className="mb-3 text-sm text-ink-500">진짜 이름 대신 별명을 써도 괜찮아요. (12글자까지)</p>
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value.slice(0, 12))}
          maxLength={12}
          placeholder="예: 그림왕, 별빛토끼"
          className="h-14 w-full rounded-2xl border-2 border-ink-200 bg-ink-50 px-4 text-xl font-semibold outline-none focus:border-mint-400 focus:bg-white"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </section>

      {err && <div className="mb-4 rounded-2xl bg-peach-100 px-4 py-3 text-center font-semibold text-peach-700">{err}</div>}

      <button
        onClick={submit}
        disabled={!num || !nick.trim() || busy}
        className="h-16 rounded-2xl bg-mint-500 text-xl font-extrabold text-white shadow-lg shadow-mint-500/30 transition active:scale-[0.98] disabled:opacity-40"
      >
        {busy ? '들어가는 중…' : num && nick.trim() ? `${num}번 ${nick.trim()}(으)로 들어가기` : '번호와 별명을 정해 주세요'}
      </button>
    </main>
  );
}
