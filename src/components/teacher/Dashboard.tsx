'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getTeacherClient } from '@/lib/supabase/teacher-client';
import { friendlyError } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { BUCKET, PHASE_LABEL, type Room } from '@/lib/types';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

const PHASE_STYLE = {
  drawing: 'bg-butter-100 text-ink-700',
  sharing: 'bg-brand-100 text-brand-700',
  closed: 'bg-ink-100 text-ink-500',
} as const;

export function Dashboard({ teacherName, rooms: initial, artCount }: { teacherName: string; rooms: Room[]; artCount: Record<string, number> }) {
  const router = useRouter();
  const toast = useToast();
  const [rooms, setRooms] = useState(initial);
  const [title, setTitle] = useState('');
  const [max, setMax] = useState(30);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<Room | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const { data, error } = await getTeacherClient().rpc('create_room', { p_title: title.trim(), p_max_students: max });
    setBusy(false);
    if (error) return toast(friendlyError(error), 'error');
    router.push(`/teacher/rooms/${(data as Room).id}?qr=1`);
  };

  const remove = async (room: Room) => {
    const sb = getTeacherClient();
    try {
      // 1) 이 수업방의 모든 이미지 파일 삭제 (Storage API)
      const { data: versions } = await sb.from('artwork_versions').select('image_path, thumb_path').eq('room_id', room.id);
      const paths = (versions ?? []).flatMap((v: { image_path: string; thumb_path: string }) => [v.image_path, v.thumb_path]);
      for (let i = 0; i < paths.length; i += 100) await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      // 2) DB 기록 삭제
      const { error } = await sb.rpc('delete_room', { p_room_id: room.id });
      if (error) throw error;
      setRooms((l) => l.filter((r) => r.id !== room.id));
      toast('수업방을 삭제했어요.', 'success');
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  const logout = async () => {
    await getTeacherClient().auth.signOut();
    router.replace('/teacher/login');
    router.refresh();
  };

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-brand-600">우리반 그림판 · 교사</div>
          <h1 className="text-3xl font-extrabold text-ink-800">{teacherName}, 안녕하세요!</h1>
        </div>
        <button onClick={logout} className="inline-flex h-11 items-center gap-2 rounded-xl px-4 font-semibold text-ink-500 hover:bg-ink-100">
          <Icon name="logout" size={18} /> 로그아웃
        </button>
      </header>

      <section className="mb-10 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink-100">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold"><Icon name="plus" /> 새 수업방 만들기</h2>
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <label className="min-w-[260px] flex-1">
            <span className="mb-1 block text-sm font-semibold text-ink-500">수업 제목</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 60))}
              placeholder="예: 3학년 2반 · 우리 동네 봄 풍경 그리기"
              className="h-14 w-full rounded-2xl border-2 border-ink-200 bg-ink-50 px-4 text-lg outline-none focus:border-brand-300 focus:bg-white"
              required
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-semibold text-ink-500">학생 수</span>
            <input
              type="number"
              min={1}
              max={60}
              value={max}
              onChange={(e) => setMax(Math.max(1, Math.min(60, Number(e.target.value) || 30)))}
              className="h-14 w-28 rounded-2xl border-2 border-ink-200 bg-ink-50 px-4 text-center text-lg outline-none focus:border-brand-300 focus:bg-white"
            />
          </label>
          <button disabled={busy || !title.trim()} className="h-14 rounded-2xl bg-brand-500 px-7 text-lg font-bold text-white hover:bg-brand-600 disabled:opacity-40">
            {busy ? '만드는 중…' : '수업방 만들기'}
          </button>
        </form>
      </section>

      <h2 className="mb-4 text-xl font-bold">내 수업방 <span className="text-ink-400">{rooms.length}</span></h2>
      {rooms.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-ink-200 p-12 text-center text-ink-400">아직 만든 수업방이 없어요.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r) => (
            <div key={r.id} className="flex flex-col rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink-100">
              <div className="mb-2 flex items-center justify-between">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${PHASE_STYLE[r.phase]}`}>{PHASE_LABEL[r.phase]}</span>
                <span className="font-mono text-sm font-bold tracking-widest text-ink-400">{r.code}</span>
              </div>
              <Link href={`/teacher/rooms/${r.id}`} className="mb-1 line-clamp-2 text-lg font-bold text-ink-800 hover:text-brand-600">
                {r.title}
              </Link>
              <div className="mb-4 text-sm text-ink-400">{formatDateTime(r.created_at)} · 작품 {artCount[r.id] ?? 0}/{r.max_students}</div>
              <div className="mt-auto flex gap-2">
                <Link href={`/teacher/rooms/${r.id}`} className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-brand-50 font-bold text-brand-700 hover:bg-brand-100">
                  {r.phase === 'closed' ? '결과 보기' : '수업 열기'}
                </Link>
                <button onClick={() => setToDelete(r)} className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-400 hover:bg-peach-50 hover:text-peach-600" aria-label="삭제">
                  <Icon name="trash" size={19} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="수업방 삭제"
        message={<>‘{toDelete?.title}’ 수업방의 <b>모든 그림과 댓글이 영구 삭제</b>돼요. 필요하면 먼저 결과물을 내려받으세요.</>}
        confirmText="영구 삭제"
        danger
        onConfirm={() => toDelete && remove(toDelete)}
        onClose={() => setToDelete(null)}
      />
    </main>
  );
}
