'use client';
import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Artwork, Participant, Room } from '@/lib/types';
import type { RoomData } from '@/lib/useRoomData';
import { useSignedUrls } from '@/lib/signedUrls';
import { Icon } from '@/components/ui/Icon';
import { ArtworkDetail } from './ArtworkDetail';

export function SharingBoard({
  sb, data, room, me, myArtwork, onEditMine,
}: {
  sb: SupabaseClient;
  data: RoomData;
  room: Room;
  me: Participant;
  myArtwork?: Artwork;
  onEditMine?: () => void;
}) {
  const { artworks, participantById, commentCount } = data;
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useMemo(
    () =>
      artworks
        .filter((a) => a.is_visible || a.participant_id === me.id)
        .map((a) => ({ a, p: participantById.get(a.participant_id) }))
        .filter((x) => x.p)
        .sort((x, y) => x.p!.student_number - y.p!.student_number),
    [artworks, participantById, me.id],
  );
  const url = useSignedUrls(sb, list.map((x) => x.a.thumb_path));
  const open = list.find((x) => x.a.id === openId);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-7xl px-4 pb-10 pt-4">
        {room.phase === 'closed' && (
          <div className="mb-4 rounded-2xl bg-lilac-100 px-5 py-4 text-center text-lg font-bold text-ink-700 animate-slide-down">
            🌟 오늘 활동이 끝났어요. 모두 수고했어요! (이제 그림과 댓글은 바꿀 수 없어요)
          </div>
        )}
        {room.phase === 'sharing' && !room.comments_enabled && (
          <div className="mb-4 flex items-center justify-center gap-2 rounded-2xl bg-butter-100 px-5 py-3 font-bold text-ink-700 animate-slide-down">
            <Icon name="pause" size={18} /> 선생님이 댓글 쓰기를 잠시 멈췄어요. 그림은 계속 감상할 수 있어요.
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-ink-800">친구들의 작품</h1>
            <p className="text-ink-500">그림을 누르면 크게 보고 느낌을 남길 수 있어요. · {list.length}점</p>
          </div>
          {onEditMine && (
            <button onClick={onEditMine} className="inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-4 font-bold text-brand-700 ring-1 ring-brand-200">
              <Icon name="brush" /> 내 그림 고치기
            </button>
          )}
        </div>

        {list.length === 0 ? (
          <div className="mt-16 text-center text-lg text-ink-400">아직 볼 수 있는 작품이 없어요.</div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
            {list.map(({ a, p }, i) => {
              const mine = a.participant_id === me.id;
              const n = commentCount.get(a.id) ?? 0;
              const src = url(a.thumb_path);
              return (
                <button
                  key={a.id}
                  onClick={() => setOpenId(a.id)}
                  className="group overflow-hidden rounded-2xl bg-white text-left shadow-sm ring-1 ring-ink-100 transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] animate-rise"
                  style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                >
                  <div className="relative aspect-[4/3] bg-ink-50">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={a.thumb_path} src={src} alt={`${p!.student_number}번 작품`} className="h-full w-full object-cover" loading="lazy" draggable={false} />
                    ) : (
                      <div className="h-full w-full animate-pulse bg-ink-100" />
                    )}
                    {mine && <span className="absolute left-2 top-2 rounded-full bg-mint-500 px-2.5 py-1 text-xs font-bold text-white">내 작품</span>}
                    {mine && !a.is_visible && (
                      <span className="absolute inset-x-2 bottom-2 rounded-lg bg-ink-800/80 px-2 py-1 text-center text-xs font-semibold text-white">선생님이 잠시 숨겼어요</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-brand-100 px-1 text-sm font-bold text-brand-700">{p!.student_number}</span>
                      <span className="truncate font-bold text-ink-700">{p!.nickname}</span>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-sm font-bold ${n ? 'bg-peach-100 text-peach-700' : 'bg-ink-50 text-ink-400'}`}>
                      <Icon name="chat" size={15} /> {n}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {open && (
        <ArtworkDetail
          sb={sb}
          data={data}
          room={room}
          me={me}
          artwork={open.a}
          author={open.p!}
          onClose={() => setOpenId(null)}
          onPrev={() => {
            const i = list.findIndex((x) => x.a.id === open.a.id);
            setOpenId(list[(i - 1 + list.length) % list.length].a.id);
          }}
          onNext={() => {
            const i = list.findIndex((x) => x.a.id === open.a.id);
            setOpenId(list[(i + 1) % list.length].a.id);
          }}
        />
      )}
    </div>
  );
}
