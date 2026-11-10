'use client';
import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artwork, Comment, Participant, Room } from '@/lib/types';
import { baseName, buildCollage, buildZip, commentsCsv, downloadBlob } from '@/lib/results';
import { friendlyError } from '@/lib/errors';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';

export function ResultsModal({
  open, onClose, sb, room, artworks, comments, participantById, artworkById,
}: {
  open: boolean;
  onClose: () => void;
  sb: SupabaseClient;
  room: Room;
  artworks: Artwork[];
  comments: Comment[];
  participantById: Map<string, Participant>;
  artworkById: Map<string, Artwork>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [includeHidden, setIncludeHidden] = useState(false);
  const [labels, setLabels] = useState(true);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setProgress('');
    try {
      await fn();
      toast('내려받기를 시작했어요.', 'success');
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(null);
      setProgress('');
    }
  };
  const prog = (d: number, t: number) => setProgress(`${d}/${t}`);

  const Item = ({ k, icon, title, desc, onClick }: { k: string; icon: 'download' | 'image' | 'chat'; title: string; desc: string; onClick: () => void }) => (
    <button onClick={onClick} disabled={!!busy} className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left ring-1 ring-ink-100 hover:ring-brand-300 disabled:opacity-50">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon name={icon} /></span>
      <span className="flex-1">
        <span className="block font-bold text-ink-800">{title}</span>
        <span className="block text-sm text-ink-500">{desc}</span>
      </span>
      {busy === k && <span className="text-sm font-bold text-brand-600">{progress || '준비 중…'}</span>}
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title="수업 결과 저장">
      <div className="space-y-3 bg-ink-50 p-5">
        <Item k="zip" icon="download" title="전체 그림 ZIP" desc={`원본 그림 ${artworks.length}장 + 댓글.csv`} onClick={() => run('zip', async () => {
          const blob = await buildZip(sb, room, artworks, participantById, artworkById, comments, prog);
          downloadBlob(blob, `${baseName(room)}_전체그림.zip`);
        })} />
        <Item k="collage" icon="image" title="협동화 한 장으로 합치기" desc="출석번호 순서로 모든 그림을 이어 붙인 큰 이미지(JPG)" onClick={() => run('collage', async () => {
          const blob = await buildCollage(sb, room, artworks, participantById, { includeHidden, labels }, prog);
          downloadBlob(blob, `${baseName(room)}_협동화.jpg`);
        })} />
        <div className="flex flex-wrap gap-4 px-2 text-sm text-ink-600">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> 번호·별명 표시</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} /> 숨긴 작품도 포함</label>
        </div>
        <Item k="csv" icon="chat" title="작품별 댓글 목록 (CSV)" desc={`댓글 ${comments.length}개 · 엑셀에서 바로 열 수 있어요`} onClick={() => run('csv', async () => {
          const csv = commentsCsv(comments, participantById, artworkById);
          downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${baseName(room)}_댓글.csv`);
        })} />
        <p className="px-2 pt-1 text-xs text-ink-400">개별 그림은 작품을 눌러 크게 본 화면에서 내려받을 수 있어요. 수업이 끝나도 이 수업방은 대시보드에서 언제든 다시 열람할 수 있어요.</p>
      </div>
    </Modal>
  );
}
