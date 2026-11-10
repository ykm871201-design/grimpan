'use client';
import { useEffect } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artwork, Comment, Participant } from '@/lib/types';
import { BUCKET } from '@/lib/types';
import { useSignedUrls } from '@/lib/signedUrls';
import { formatTime } from '@/lib/format';
import { artworkFileName, downloadBlob } from '@/lib/results';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';

export function ArtworkModal({
  sb, artwork, author, comments, participantById, onClose, onPrev, onNext, onToggleVisible, onHideComment, onDeleteComment,
}: {
  sb: SupabaseClient;
  artwork: Artwork;
  author?: Participant;
  comments: Comment[];
  participantById: Map<string, Participant>;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleVisible: (a: Artwork) => void;
  onHideComment: (c: Comment) => void;
  onDeleteComment: (c: Comment) => void;
}) {
  const url = useSignedUrls(sb, [artwork.image_path, artwork.thumb_path]);
  const src = url(artwork.image_path) ?? url(artwork.thumb_path);
  const list = comments.filter((c) => c.artwork_id === artwork.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onPrev, onNext]);

  const download = async () => {
    const { data } = await sb.storage.from(BUCKET).download(artwork.image_path);
    if (data) downloadBlob(data, artworkFileName(author, artwork));
  };

  return (
    <Modal
      open
      full
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-brand-100 px-1.5 text-brand-700">{author?.student_number}</span>
          {author?.nickname}의 작품
          {!artwork.is_visible && <span className="rounded-full bg-peach-100 px-2.5 py-0.5 text-sm text-peach-700">숨김 상태</span>}
          <span className="text-sm font-medium text-ink-400">· 최근 제출 {formatTime(artwork.updated_at)}{artwork.version > 1 ? ` · ${artwork.version}번째 제출` : ''}</span>
        </span>
      }
    >
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-ink-50 p-4">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={artwork.image_path} src={src} alt="작품" className={`max-h-full max-w-full rounded-lg bg-white shadow-xl ${artwork.is_visible ? '' : 'opacity-60'}`} />
          ) : (
            <div className="aspect-[4/3] w-2/3 animate-pulse rounded-lg bg-ink-100" />
          )}
          <button onClick={onPrev} className="absolute left-3 top-1/2 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow" aria-label="이전"><Icon name="back" size={28} /></button>
          <button onClick={onNext} className="absolute right-3 top-1/2 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow" aria-label="다음"><Icon name="next" size={28} /></button>
        </div>
        <aside className="flex min-h-0 w-full flex-col border-t border-ink-100 lg:w-[380px] lg:border-l lg:border-t-0">
          <div className="flex gap-2 border-b border-ink-100 p-3">
            <button onClick={() => onToggleVisible(artwork)} className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl font-bold ${artwork.is_visible ? 'bg-ink-100 text-ink-700' : 'bg-mint-500 text-white'}`}>
              <Icon name={artwork.is_visible ? 'eyeOff' : 'eye'} size={18} /> {artwork.is_visible ? '학생들에게 숨기기' : '다시 공개하기'}
            </button>
            <button onClick={download} className="inline-flex h-11 items-center gap-1 rounded-xl border border-ink-200 px-3 font-bold text-ink-600" title="이 그림 내려받기"><Icon name="download" size={18} /></button>
          </div>
          <div className="px-4 pt-3 font-bold text-ink-600">댓글 {list.length}개</div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 scrollbar-thin">
            {list.length === 0 && <div className="py-10 text-center text-ink-400">아직 댓글이 없어요.</div>}
            {list.map((c) => {
              const a = participantById.get(c.author_participant_id);
              return (
                <div key={c.id} className={`rounded-xl px-3 py-2 ${c.is_hidden ? 'bg-ink-50 opacity-60' : 'bg-white ring-1 ring-ink-100'}`}>
                  <div className="flex items-center justify-between text-xs font-bold text-ink-500">
                    <span>{a ? `${a.student_number}번 ${a.nickname}` : ''}{c.is_hidden && ' · 숨김'}</span>
                    <span className="font-medium text-ink-400">{formatTime(c.created_at)}</span>
                  </div>
                  <div className={`text-[15px] ${c.is_hidden ? 'line-through' : ''}`}>{c.body}</div>
                  <div className="mt-1 flex justify-end gap-1">
                    <button onClick={() => onHideComment(c)} className="rounded-md px-2 py-1 text-xs font-bold text-ink-500 hover:bg-ink-100">{c.is_hidden ? '보이기' : '숨기기'}</button>
                    <button onClick={() => onDeleteComment(c)} className="rounded-md px-2 py-1 text-xs font-bold text-peach-600 hover:bg-peach-50">삭제</button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </Modal>
  );
}
