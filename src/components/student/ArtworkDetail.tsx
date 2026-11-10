'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMENT_COOLDOWN_MS, COMMENT_MAX, type Artwork, type Comment, type Participant, type Room } from '@/lib/types';
import type { RoomData } from '@/lib/useRoomData';
import { useSignedUrls } from '@/lib/signedUrls';
import { friendlyError } from '@/lib/errors';
import { formatTime } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';

const HINTS = ['친구의 그림에서 인상 깊었던 점을 써 보세요.', '이 그림을 보니 어떤 느낌이 드나요?', '칭찬하고 싶은 부분을 찾아보세요.'];
const STARTERS = [
  { label: '👀 인상 깊은 점', text: '이 그림에서 인상 깊은 점은 ' },
  { label: '💭 느낌', text: '이 그림을 보니 ' },
  { label: '👏 칭찬', text: '칭찬하고 싶은 부분은 ' },
  { label: '🎨 색깔', text: '색깔이 ' },
];

export function ArtworkDetail({
  sb, data, room, me, artwork, author, onClose, onPrev, onNext,
}: {
  sb: SupabaseClient;
  data: RoomData;
  room: Room;
  me: Participant;
  artwork: Artwork;
  author: Participant;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const toast = useToast();
  const { comments, setComments, participantById } = data;
  const url = useSignedUrls(sb, [artwork.image_path, artwork.thumb_path]);
  const full = url(artwork.image_path);
  const thumb = url(artwork.thumb_path);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [hint, setHint] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const mine = artwork.participant_id === me.id;
  const list = useMemo(
    () => comments.filter((c) => c.artwork_id === artwork.id && !c.is_hidden).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
    [comments, artwork.id],
  );

  useEffect(() => {
    const t = setInterval(() => setHint((h) => (h + 1) % HINTS.length), 4000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [cooldownUntil]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [list.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  const blockedReason =
    room.phase === 'closed'
      ? '활동이 끝나서 댓글을 쓸 수 없어요.'
      : room.phase !== 'sharing'
        ? '느낌 나누기 시간에 댓글을 쓸 수 있어요.'
        : !room.comments_enabled
          ? '선생님이 댓글 쓰기를 잠시 멈췄어요.'
          : mine
            ? '내 작품에 친구들이 남긴 댓글을 읽어 보세요!'
            : null;

  const cooling = cooldownUntil > now;
  const trimmed = text.replace(/\s+/g, ' ').trim();

  const send = async () => {
    if (!trimmed || sending || cooling || blockedReason) return;
    setSending(true);
    const { data: row, error } = await sb.rpc('post_comment', { p_artwork_id: artwork.id, p_body: trimmed });
    setSending(false);
    if (error) {
      toast(friendlyError(error), 'error');
      return;
    }
    const c = row as Comment;
    setComments((l) => (l.some((x) => x.id === c.id) ? l : [c, ...l]));
    setText('');
    setCooldownUntil(Date.now() + COMMENT_COOLDOWN_MS);
    setNow(Date.now());
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-paper animate-fade-in">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink-100 bg-white px-3 py-2">
        <button onClick={onClose} className="inline-flex h-12 items-center gap-1 rounded-xl px-3 text-lg font-bold text-ink-700 hover:bg-ink-100">
          <Icon name="back" /> 목록으로
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-brand-100 px-1.5 font-bold text-brand-700">{author.student_number}</span>
          <span className="truncate text-lg font-extrabold">{author.nickname}의 작품</span>
        </div>
        <div className="flex gap-1">
          <button onClick={onPrev} className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink-50 text-ink-600" aria-label="이전 작품">
            <Icon name="back" />
          </button>
          <button onClick={onNext} className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink-50 text-ink-600" aria-label="다음 작품">
            <Icon name="next" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col landscape:flex-row">
        <div className="flex min-h-0 flex-1 items-center justify-center p-3 portrait:max-h-[50%]">
          {full || thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={artwork.image_path} src={full ?? thumb!} alt="작품" className="max-h-full max-w-full rounded-xl bg-white object-contain shadow-lg ring-1 ring-ink-200" draggable={false} />
          ) : (
            <div className="aspect-[4/3] w-full max-w-3xl animate-pulse rounded-xl bg-ink-100" />
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col border-ink-100 bg-white landscape:max-w-[420px] landscape:border-l portrait:border-t">
          <div className="flex items-center gap-2 px-4 pt-3 text-base font-bold text-ink-600">
            <Icon name="chat" size={18} /> 댓글 {list.length}개
          </div>
          <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3 scrollbar-thin">
            {list.length === 0 && <div className="py-8 text-center text-ink-400">첫 번째 느낌을 남겨 주세요!</div>}
            {list.map((c) => {
              const a = participantById.get(c.author_participant_id);
              const own = c.author_participant_id === me.id;
              return (
                <div key={c.id} className={`rounded-2xl px-4 py-2.5 animate-pop-in ${own ? 'bg-mint-50 ring-1 ring-mint-200' : 'bg-ink-50'}`}>
                  <div className="mb-0.5 flex items-center justify-between text-xs font-bold text-ink-500">
                    <span>{a ? `${a.student_number}번 ${a.nickname}` : '친구'}{own && ' (나)'}</span>
                    <span className="font-medium text-ink-400">{formatTime(c.created_at)}</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[17px] leading-snug text-ink-800">{c.body}</div>
                </div>
              );
            })}
          </div>

          <div className="shrink-0 border-t border-ink-100 p-3">
            {blockedReason ? (
              <div className="rounded-2xl bg-ink-50 px-4 py-4 text-center font-semibold text-ink-500">{blockedReason}</div>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {STARTERS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => {
                        setText((t) => (t.trim() ? t : s.text));
                        inputRef.current?.focus();
                      }}
                      className="rounded-full bg-butter-100 px-3 py-1.5 text-sm font-bold text-ink-700 active:scale-95"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-end gap-2">
                  <div className="relative flex-1">
                    <textarea
                      ref={inputRef}
                      value={text}
                      onChange={(e) => setText(e.target.value.slice(0, COMMENT_MAX))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      rows={2}
                      maxLength={COMMENT_MAX}
                      placeholder={HINTS[hint]}
                      className="w-full resize-none rounded-2xl border-2 border-ink-200 bg-ink-50 px-4 py-3 pr-14 text-[17px] outline-none focus:border-brand-300 focus:bg-white"
                    />
                    <span className={`absolute bottom-2.5 right-3 text-xs font-semibold ${text.length >= COMMENT_MAX ? 'text-peach-600' : 'text-ink-400'}`}>
                      {text.length}/{COMMENT_MAX}
                    </span>
                  </div>
                  <button
                    onClick={send}
                    disabled={!trimmed || sending || cooling}
                    className="flex h-[68px] min-w-[84px] flex-col items-center justify-center rounded-2xl bg-brand-500 px-3 font-bold text-white shadow-md shadow-brand-500/30 active:scale-95 disabled:opacity-40"
                  >
                    {cooling ? `${Math.ceil((cooldownUntil - now) / 1000)}초` : sending ? '…' : (<><Icon name="send" size={20} /> 등록</>)}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-ink-400">친구가 기분 좋아지는 따뜻한 말로, 구체적으로 써 보세요 😊</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
