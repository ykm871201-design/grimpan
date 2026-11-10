'use client';
import { useState } from 'react';
import type { Artwork, Participant, Room } from '@/lib/types';
import { formatTime } from '@/lib/format';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';

export function ManageModal({
  open, onClose, room, participants, artworkByParticipant, onlineIds,
  onSaveSettings, onToggleResubmit, onToggleComments, onRelease,
}: {
  open: boolean;
  onClose: () => void;
  room: Room;
  participants: Participant[];
  artworkByParticipant: Map<string, Artwork>;
  onlineIds: Set<string>;
  onSaveSettings: (title: string, max: number) => Promise<void>;
  onToggleResubmit: (v: boolean) => void;
  onToggleComments: (v: boolean) => void;
  onRelease: (p: Participant) => void;
}) {
  const [title, setTitle] = useState(room.title);
  const [max, setMax] = useState(room.max_students);
  const [releaseTarget, setReleaseTarget] = useState<Participant | null>(null);

  const byNumber = new Map(participants.map((p) => [p.student_number, p]));
  const notSubmitted: { n: number; p?: Participant }[] = [];
  for (let n = 1; n <= room.max_students; n++) {
    const p = byNumber.get(n);
    if (!p || !artworkByParticipant.get(p.id)) notSubmitted.push({ n, p });
  }
  const submitted = participants.filter((p) => artworkByParticipant.get(p.id)).length;
  const online = participants.filter((p) => onlineIds.has(p.id)).length;

  return (
    <Modal open={open} onClose={onClose} wide title="수업방 관리">
      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-5">
          <section className="grid grid-cols-3 gap-2 text-center">
            {[
              ['현재 접속', `${online}명`, 'bg-mint-50 text-mint-700'],
              ['참여', `${participants.length}명`, 'bg-brand-50 text-brand-700'],
              ['제출 완료', `${submitted}/${room.max_students}`, 'bg-butter-50 text-ink-700'],
            ].map(([k, v, c]) => (
              <div key={k} className={`rounded-2xl px-2 py-3 ${c}`}>
                <div className="text-xs font-bold opacity-70">{k}</div>
                <div className="text-2xl font-extrabold">{v}</div>
              </div>
            ))}
          </section>

          <section className="space-y-3 rounded-2xl bg-ink-50 p-4">
            <h3 className="font-bold">수업 설정</h3>
            <label className="block">
              <span className="text-sm font-semibold text-ink-500">수업 제목</span>
              <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 60))} className="mt-1 h-11 w-full rounded-xl border border-ink-200 bg-white px-3" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink-500">학생 수 (번호 범위)</span>
              <input type="number" min={1} max={60} value={max} onChange={(e) => setMax(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} className="mt-1 h-11 w-28 rounded-xl border border-ink-200 bg-white px-3" />
            </label>
            <button onClick={() => onSaveSettings(title, max)} disabled={title === room.title && max === room.max_students} className="h-10 rounded-xl bg-brand-500 px-4 text-sm font-bold text-white disabled:opacity-40">
              저장
            </button>
            <div className="space-y-3 border-t border-ink-200 pt-3">
              <Switch checked={room.allow_resubmit_in_sharing} onChange={onToggleResubmit} label="느낌 나누기 중에도 그림 수정·재제출 허용" />
              <Switch checked={room.comments_enabled} onChange={onToggleComments} label="댓글 쓰기 허용" />
            </div>
          </section>

          <section className="rounded-2xl bg-peach-50 p-4">
            <h3 className="mb-2 font-bold text-peach-700">미제출 {notSubmitted.length}명</h3>
            <div className="flex flex-wrap gap-1.5">
              {notSubmitted.length === 0 && <span className="text-sm text-ink-500">모두 제출했어요! 🎉</span>}
              {notSubmitted.map(({ n, p }) => (
                <span key={n} className={`rounded-lg px-2 py-1 text-sm font-semibold ${p ? 'bg-white text-ink-700' : 'bg-white/50 text-ink-400'}`}>
                  {n}번{p ? ` ${p.nickname}` : ' (미참여)'}
                </span>
              ))}
            </div>
          </section>
        </div>

        <section>
          <h3 className="mb-2 font-bold">참여 학생</h3>
          <p className="mb-3 text-sm text-ink-500">학생이 다른 태블릿으로 바꿔야 하면 <b>번호 재설정</b>을 누르세요. 그 번호로 새 기기에서 다시 들어오면 기존 그림이 이어집니다.</p>
          <div className="max-h-[60vh] overflow-auto rounded-2xl ring-1 ring-ink-100 scrollbar-thin">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ink-50 text-left text-ink-500">
                <tr>
                  <th className="px-3 py-2">번호</th>
                  <th className="px-3 py-2">별명</th>
                  <th className="px-3 py-2">접속</th>
                  <th className="px-3 py-2">제출</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => {
                  const a = artworkByParticipant.get(p.id);
                  return (
                    <tr key={p.id} className="border-t border-ink-100">
                      <td className="px-3 py-2 font-bold">{p.student_number}</td>
                      <td className="px-3 py-2">{p.nickname}</td>
                      <td className="px-3 py-2">
                        {p.user_id === null ? <span className="text-butter-400 font-semibold">재설정됨</span> : onlineIds.has(p.id) ? <span className="font-semibold text-mint-600">● 접속 중</span> : <span className="text-ink-400">○</span>}
                      </td>
                      <td className="px-3 py-2">{a ? `${formatTime(a.updated_at)}${a.version > 1 ? ` (${a.version}회)` : ''}` : <span className="text-peach-600">미제출</span>}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => setReleaseTarget(p)} disabled={p.user_id === null} className="rounded-lg px-2 py-1 text-xs font-bold text-ink-500 hover:bg-ink-100 disabled:opacity-30">번호 재설정</button>
                      </td>
                    </tr>
                  );
                })}
                {participants.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-ink-400">아직 들어온 학생이 없어요.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={!!releaseTarget}
        title="번호 재설정"
        message={<>{releaseTarget?.student_number}번 {releaseTarget?.nickname} 학생의 현재 기기 연결을 해제할까요? 그 번호로 다시 들어오는 기기가 기존 그림과 댓글을 이어받아요.</>}
        confirmText="재설정"
        onConfirm={() => releaseTarget && onRelease(releaseTarget)}
        onClose={() => setReleaseTarget(null)}
      />
    </Modal>
  );
}
