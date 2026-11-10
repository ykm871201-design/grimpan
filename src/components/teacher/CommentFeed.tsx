'use client';
import { useEffect, useRef, useState } from 'react';
import type { Artwork, Comment, Participant, Room } from '@/lib/types';
import { formatTime } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';
import { Switch } from '@/components/ui/Switch';

export function CommentFeed({
  room,
  comments,
  participantById,
  artworkById,
  loaded,
  big,
  onToggleBig,
  onToggleComments,
  onOpenArtwork,
  onHide,
  onDelete,
}: {
  room: Room;
  comments: Comment[];
  participantById: Map<string, Participant>;
  artworkById: Map<string, Artwork>;
  loaded: boolean;
  big: boolean;
  onToggleBig: () => void;
  onToggleComments: (v: boolean) => void;
  onOpenArtwork: (artworkId: string) => void;
  onHide: (c: Comment) => void;
  onDelete: (c: Comment) => void;
}) {
  // 처음 불러온 댓글은 강조하지 않고, 이후 새로 들어온 댓글만 강조
  const seen = useRef<Set<string> | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    if (loaded && seen.current === null) {
      seen.current = new Set(comments.map((c) => c.id));
      force((x) => x + 1);
    }
  }, [loaded, comments]);
  const isNew = (id: string) => seen.current !== null && !seen.current.has(id);
  useEffect(() => {
    if (!seen.current) return;
    const fresh = comments.filter((c) => !seen.current!.has(c.id));
    if (!fresh.length) return;
    const t = setTimeout(() => {
      fresh.forEach((c) => seen.current!.add(c.id));
      force((x) => x + 1);
    }, 6000);
    return () => clearTimeout(t);
  }, [comments]);

  const visibleCount = comments.filter((c) => !c.is_hidden).length;
  const label = (p?: Participant) => (p ? `${p.student_number}번 ${p.nickname}` : '알 수 없음');

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            {room.phase === 'sharing' && room.comments_enabled && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-peach-400 opacity-70" />}
            <span className={`relative inline-flex h-3 w-3 rounded-full ${room.phase === 'sharing' && room.comments_enabled ? 'bg-peach-500' : 'bg-ink-300'}`} />
          </span>
          <h2 className={`font-extrabold text-ink-800 ${big ? 'text-2xl' : 'text-lg'}`}>실시간 댓글 중계</h2>
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-sm font-bold text-ink-500">{visibleCount}</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={room.comments_enabled} onChange={onToggleComments} label={room.comments_enabled ? '댓글 허용' : '댓글 멈춤'} disabled={room.phase === 'closed'} />
          <button onClick={onToggleBig} className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100" title={big ? '기본 화면' : '중계 모드(크게 보기)'}>
            <Icon name={big ? 'shrink' : 'radio'} size={20} />
          </button>
        </div>
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto px-3 py-3 scrollbar-thin ${big ? 'grid auto-rows-min grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3' : 'space-y-2'}`}>
        {comments.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-2 px-4 py-16 text-center text-ink-400">
            <Icon name="chat" size={36} />
            {room.phase === 'drawing' ? '‘느낌 나누기 시작’을 누르면 학생들의 댓글이 여기에 실시간으로 올라와요.' : '아직 댓글이 없어요.'}
          </div>
        )}
        {comments.map((c) => {
          const author = participantById.get(c.author_participant_id);
          const art = artworkById.get(c.artwork_id);
          const target = art ? participantById.get(art.participant_id) : undefined;
          const fresh = isNew(c.id);
          return (
            <div
              key={c.id}
              className={`group rounded-2xl border px-3.5 py-2.5 transition ${
                c.is_hidden ? 'border-dashed border-ink-200 bg-ink-50 opacity-60' : fresh ? 'border-butter-400 animate-flash' : 'border-ink-100 bg-white'
              } ${fresh ? 'animate-slide-down' : ''}`}
            >
              <button onClick={() => onOpenArtwork(c.artwork_id)} className="block w-full text-left">
                <div className={`flex flex-wrap items-center gap-x-1.5 font-bold ${big ? 'text-lg' : 'text-[13px]'}`}>
                  <span className="text-mint-700">{label(author)}</span>
                  <span className="text-ink-300">→</span>
                  <span className="text-brand-600">{target ? `${target.student_number}번 ${target.nickname} 작품` : '작품'}</span>
                  <span className={`ml-auto font-medium text-ink-400 ${big ? 'text-sm' : 'text-[11px]'}`}>{formatTime(c.created_at)}</span>
                </div>
                <div className={`mt-0.5 break-words leading-snug text-ink-800 ${big ? 'text-2xl font-semibold' : 'text-[15px]'} ${c.is_hidden ? 'line-through' : ''}`}>
                  “{c.body}”
                </div>
              </button>
              <div className={`mt-1.5 flex justify-end gap-1 ${c.is_hidden ? '' : 'opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'}`}>
                {c.is_hidden && <span className="mr-auto self-center text-xs font-bold text-peach-600">학생에게 숨김</span>}
                <button onClick={() => onHide(c)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-bold text-ink-500 hover:bg-ink-100">
                  <Icon name={c.is_hidden ? 'eye' : 'eyeOff'} size={14} /> {c.is_hidden ? '다시 보이기' : '숨기기'}
                </button>
                <button onClick={() => onDelete(c)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-bold text-peach-600 hover:bg-peach-50">
                  <Icon name="trash" size={14} /> 삭제
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
