'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Artwork, Participant } from '@/lib/types';
import { Icon } from '@/components/ui/Icon';

export interface Slot {
  number: number;
  participant?: Participant;
  artwork?: Artwork;
}

/** 화면 크기와 작품 수에 맞춰 스크롤 없이 가장 크게 보이는 열 수를 계산 */
function useFitGrid(count: number, labelH: number, gap: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const fit = useMemo(() => {
    const n = Math.max(1, count);
    const { w, h } = box;
    if (!w || !h) return { cols: Math.min(n, 6), tileW: 200 };
    let best = { cols: 1, tileW: 0 };
    for (let c = 1; c <= n; c++) {
      const rows = Math.ceil(n / c);
      const byW = (w - gap * (c - 1)) / c;
      const byH = ((h - gap * (rows - 1)) / rows - labelH) / 0.75;
      const tw = Math.min(byW, byH);
      if (tw > best.tileW) best = { cols: c, tileW: tw };
    }
    // 학생이 아주 많으면 최소 크기를 보장하고 스크롤 허용
    if (best.tileW < 130) {
      const c = Math.max(1, Math.floor((w + gap) / (130 + gap)));
      return { cols: c, tileW: (w - gap * (c - 1)) / c };
    }
    return { cols: best.cols, tileW: Math.floor(best.tileW) };
  }, [box, count, labelH, gap]);
  return { ref, ...fit };
}

export function TeacherGallery({
  slots,
  thumbUrl,
  onlineIds,
  commentCount,
  mosaic,
  onOpen,
  onToggleVisible,
}: {
  slots: Slot[];
  thumbUrl: (path?: string | null) => string | null;
  onlineIds: Set<string>;
  commentCount: Map<string, number>;
  mosaic: boolean;
  onOpen: (artworkId: string) => void;
  onToggleVisible: (a: Artwork) => void;
}) {
  const gap = mosaic ? 0 : 10;
  const labelH = mosaic ? 0 : 34;
  const { ref, cols, tileW } = useFitGrid(slots.length, labelH, gap);

  return (
    <div ref={ref} className="h-full w-full overflow-auto scrollbar-thin">
      {slots.length === 0 ? (
        <div className="flex h-full items-center justify-center text-lg text-ink-400">아직 제출된 작품이 없어요.</div>
      ) : (
        <div
          className={`mx-auto grid content-center ${mosaic ? 'overflow-hidden rounded-xl bg-[#fffdf8] shadow-xl ring-1 ring-ink-200' : ''}`}
          style={{ gridTemplateColumns: `repeat(${cols}, ${tileW}px)`, gap, width: cols * tileW + gap * (cols - 1), minHeight: mosaic ? undefined : '100%' }}
        >
          {slots.map((s) => (
            <Tile
              key={s.number}
              slot={s}
              src={thumbUrl(s.artwork?.thumb_path)}
              online={!!s.participant && onlineIds.has(s.participant.id)}
              comments={s.artwork ? commentCount.get(s.artwork.id) ?? 0 : 0}
              mosaic={mosaic}
              onOpen={onOpen}
              onToggleVisible={onToggleVisible}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({
  slot, src, online, comments, mosaic, onOpen, onToggleVisible,
}: {
  slot: Slot;
  src: string | null;
  online: boolean;
  comments: number;
  mosaic: boolean;
  onOpen: (id: string) => void;
  onToggleVisible: (a: Artwork) => void;
}) {
  const { number, participant: p, artwork: a } = slot;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  // 새 이미지를 미리 불러온 뒤 교체 → 재제출 시 깜빡임 없이 자연스럽게 갱신
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setLoadedSrc(src);
    img.src = src;
  }, [src]);

  const img = a && loadedSrc && (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={a.thumb_path} src={loadedSrc} alt={`${number}번 작품`} draggable={false} className={`tile-update h-full w-full object-cover ${!a.is_visible ? 'opacity-35 grayscale' : ''}`} />
  );

  if (mosaic) {
    return (
      <button onClick={() => a && onOpen(a.id)} className="relative aspect-[4/3] overflow-hidden bg-[#fffdf8]" title={p ? `${number}번 ${p.nickname}` : `${number}번`}>
        {img}
        {a && !a.is_visible && <span className="absolute right-1 top-1 rounded bg-ink-800/70 p-0.5 text-white"><Icon name="eyeOff" size={14} /></span>}
        {!a && <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-ink-200">{number}</span>}
      </button>
    );
  }

  return (
    <div className={`group flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ${a ? (a.is_visible ? 'ring-ink-100' : 'ring-2 ring-peach-300') : 'ring-ink-100'}`}>
      <button
        onClick={() => a && onOpen(a.id)}
        disabled={!a}
        className={`relative aspect-[4/3] w-full overflow-hidden ${a ? 'bg-white' : 'bg-[repeating-linear-gradient(135deg,#f7f7f9_0_10px,#f1f2f5_10px_20px)]'}`}
      >
        {img}
        {a && !loadedSrc && <span className="absolute inset-0 animate-pulse bg-ink-100" />}
        {!a && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-2xl font-extrabold text-ink-300">{number}</span>
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold text-ink-400">{p ? '미제출 · 그리는 중' : '미참여'}</span>
          </span>
        )}
        {a && !a.is_visible && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="inline-flex items-center gap-1 rounded-full bg-ink-800/80 px-3 py-1 text-sm font-bold text-white"><Icon name="eyeOff" size={16} /> 숨김</span>
          </span>
        )}
        {a && a.version > 1 && <span className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[11px] font-bold text-brand-600 shadow-sm">수정 {a.version - 1}회</span>}
      </button>
      <div className="flex h-[34px] items-center gap-1.5 px-2 text-sm">
        <span className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-mint-500' : 'bg-ink-200'}`} title={online ? '접속 중' : '접속 안 함'} />
        <span className="shrink-0 font-extrabold text-ink-700">{number}</span>
        <span className="min-w-0 flex-1 truncate font-semibold text-ink-500">{p?.nickname ?? ''}</span>
        {a && comments > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-peach-100 px-1.5 text-xs font-bold text-peach-700"><Icon name="chat" size={12} />{comments}</span>
        )}
        {a && (
          <button
            onClick={() => onToggleVisible(a)}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${a.is_visible ? 'text-ink-400 hover:bg-ink-100' : 'bg-peach-100 text-peach-600'}`}
            title={a.is_visible ? '숨기기' : '공개하기'}
            aria-label={a.is_visible ? '숨기기' : '공개하기'}
          >
            <Icon name={a.is_visible ? 'eye' : 'eyeOff'} size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
