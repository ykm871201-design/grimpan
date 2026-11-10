'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import {
  COLORS, ERASER_SCALE, H, SIZES, W, blobToImage, drawStroke, exportImages, isBlank, renderOps,
  type Op, type StrokeOp, type Tool,
} from './engine';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/Modal';
import { toggleFullscreen, isFullscreen } from '@/lib/fullscreen';

interface Draft {
  v: 1;
  ops: Op[];
  bg: Blob | null;
  seq: number;
  submittedSeq: number;
}

export interface DrawingBoardProps {
  draftKey: string;
  ready: boolean;
  hasSubmission: boolean;
  canSubmit: boolean;
  disabledReason?: string | null;
  loadServerImage: () => Promise<Blob | null>;
  onSubmit: (imgs: { full: Blob; thumb: Blob }) => Promise<void>;
  headerLeft?: ReactNode;
  onBlankSubmit?: () => void;
}

export function DrawingBoard(props: DrawingBoardProps) {
  const { draftKey, ready, hasSubmission, canSubmit, disabledReason, loadServerImage, onSubmit, headerLeft, onBlankSubmit } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);

  const opsRef = useRef<Op[]>([]);
  const redoRef = useRef<Op[]>([]);
  const bgRef = useRef<CanvasImageSource | null>(null);
  const bgBlobRef = useRef<Blob | null>(null);
  const seqRef = useRef(0);
  const submittedSeqRef = useRef(0);
  const scaleRef = useRef(1);
  const curRef = useRef<StrokeOp | null>(null);
  const activePointer = useRef<number | null>(null);
  const penSeen = useRef(false);
  const rafRef = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [, setTick] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [big, setBig] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const rerender = () => setTick((t) => t + 1);

  // ---------- 렌더링 ----------
  const renderBase = useCallback(() => {
    const c = baseRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    renderOps(ctx, opsRef.current, bgRef.current, scaleRef.current, c.width, c.height);
  }, []);

  const drawLive = useCallback(() => {
    rafRef.current = null;
    const c = liveRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (curRef.current) {
      ctx.setTransform(scaleRef.current, 0, 0, scaleRef.current, 0, 0);
      drawStroke(ctx, curRef.current);
    }
  }, []);

  const scheduleLive = () => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(drawLive);
  };

  // ---------- 크기 맞추기 (4:3 유지, DPR 반영) ----------
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const r = stage.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      let cssW = r.width;
      let cssH = (cssW * H) / W;
      if (cssH > r.height) {
        cssH = r.height;
        cssW = (cssH * W) / H;
      }
      cssW = Math.floor(cssW);
      cssH = Math.floor(cssH);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const pw = Math.round(cssW * dpr);
      const ph = Math.round(cssH * dpr);
      for (const c of [baseRef.current, liveRef.current]) {
        if (!c) continue;
        c.style.width = `${cssW}px`;
        c.style.height = `${cssH}px`;
        if (c.width !== pw || c.height !== ph) {
          c.width = pw;
          c.height = ph;
        }
      }
      scaleRef.current = pw / W;
      renderBase();
      drawLive();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    fit();
    return () => ro.disconnect();
  }, [renderBase, drawLive]);

  // ---------- 임시 저장 (IndexedDB) ----------
  const saveNow = useCallback(async () => {
    const d: Draft = { v: 1, ops: opsRef.current, bg: bgBlobRef.current, seq: seqRef.current, submittedSeq: submittedSeqRef.current };
    try {
      await idbSet(draftKey, d);
    } catch {
      /* 저장공간 부족 등 */
    }
  }, [draftKey]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveNow(), 600);
  }, [saveNow]);

  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        void saveNow();
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [saveNow]);

  // ---------- 복구: 이 기기의 임시 저장 → 없으면 서버에 제출된 그림 ----------
  useEffect(() => {
    if (!ready || loaded) return;
    let cancelled = false;
    (async () => {
      let d: Draft | undefined;
      try {
        d = await idbGet<Draft>(draftKey);
      } catch {
        d = undefined;
      }
      if (cancelled) return;
      if (d && d.v === 1) {
        opsRef.current = d.ops ?? [];
        bgBlobRef.current = d.bg ?? null;
        bgRef.current = d.bg ? await blobToImage(d.bg).catch(() => null) : null;
        seqRef.current = d.seq ?? 0;
        submittedSeqRef.current = d.submittedSeq ?? 0;
      } else if (hasSubmission) {
        const blob = await loadServerImage().catch(() => null);
        if (cancelled) return;
        if (blob) {
          bgBlobRef.current = blob;
          bgRef.current = await blobToImage(blob).catch(() => null);
        }
      }
      if (cancelled) return;
      setLoaded(true);
      renderBase();
      rerender();
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, loaded, draftKey, hasSubmission, loadServerImage, renderBase]);

  // ---------- 편집 동작 ----------
  const changed = useCallback(() => {
    seqRef.current += 1;
    scheduleSave();
    rerender();
  }, [scheduleSave]);

  const undo = useCallback(() => {
    const op = opsRef.current.pop();
    if (!op) return;
    redoRef.current.push(op);
    renderBase();
    changed();
  }, [renderBase, changed]);

  const redo = useCallback(() => {
    const op = redoRef.current.pop();
    if (!op) return;
    opsRef.current.push(op);
    renderBase();
    changed();
  }, [renderBase, changed]);

  const clearAll = () => {
    opsRef.current.push({ kind: 'clear' });
    redoRef.current = [];
    renderBase();
    changed();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ---------- 포인터 입력 (마우스 · 손가락 · 스타일러스) ----------
  const toLogical = (e: { clientX: number; clientY: number }) => {
    const c = liveRef.current!;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    return [Math.max(-20, Math.min(W + 20, x)), Math.max(-20, Math.min(H + 20, y))];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!loaded) return;
    if (e.pointerType === 'pen') penSeen.current = true;
    // 손바닥 거치 방지: 펜을 한 번이라도 쓰면 손가락 터치는 그리기에서 제외
    if (e.pointerType === 'touch' && penSeen.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (activePointer.current !== null) return; // 두 번째 손가락 무시
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    activePointer.current = e.pointerId;
    const [x, y] = toLogical(e);
    curRef.current = {
      kind: 'stroke',
      tool,
      color,
      size: tool === 'eraser' ? Math.round(size * ERASER_SCALE) : size,
      pts: [x, y],
    };
    scheduleLive();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== e.pointerId || !curRef.current) return;
    e.preventDefault();
    const native = e.nativeEvent as PointerEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native];
    const pts = curRef.current.pts;
    for (const ev of events.length ? events : [native]) {
      const [x, y] = toLogical(ev);
      const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
      if (Math.abs(x - lx) + Math.abs(y - ly) < 1.2) continue;
      pts.push(x, y);
    }
    scheduleLive();
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    const s = curRef.current;
    curRef.current = null;
    if (!s) return;
    opsRef.current.push(s);
    redoRef.current = [];
    const ctx = baseRef.current?.getContext('2d');
    if (ctx) {
      ctx.setTransform(scaleRef.current, 0, 0, scaleRef.current, 0, 0);
      drawStroke(ctx, s);
    }
    drawLive();
    changed();
  };

  // iOS 사파리: 길게 누를 때 돋보기/선택, 스크롤·확대 제스처 차단
  useEffect(() => {
    const c = liveRef.current;
    if (!c) return;
    const prevent = (ev: TouchEvent) => ev.preventDefault();
    c.addEventListener('touchstart', prevent, { passive: false });
    c.addEventListener('touchmove', prevent, { passive: false });
    return () => {
      c.removeEventListener('touchstart', prevent);
      c.removeEventListener('touchmove', prevent);
    };
  }, []);

  // ---------- 크게 그리기 ----------
  const toggleBig = async () => {
    const next = !big;
    setBig(next);
    if (next && !isFullscreen()) await toggleFullscreen(wrapRef.current);
    if (!next && isFullscreen()) await toggleFullscreen();
  };
  useEffect(() => {
    const onFs = () => {
      if (!isFullscreen()) setBig(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, []);

  // ---------- 제출 ----------
  const submit = async () => {
    if (submitting || !canSubmit) return;
    if (isBlank(opsRef.current, Boolean(bgRef.current))) {
      onBlankSubmit?.();
      return;
    }
    setSubmitting(true);
    const seqAtExport = seqRef.current;
    try {
      const imgs = await exportImages(opsRef.current, bgRef.current);
      await onSubmit(imgs);
      submittedSeqRef.current = seqAtExport;
      await saveNow();
      rerender();
    } catch {
      /* 오류 메시지는 onSubmit 쪽에서 표시 */
    } finally {
      setSubmitting(false);
    }
  };

  const dirty = seqRef.current !== submittedSeqRef.current;
  const statusPill = !hasSubmission ? (
    <span className="rounded-full bg-ink-100 px-3 py-1.5 text-sm font-semibold text-ink-600">아직 제출 전</span>
  ) : dirty ? (
    <span className="rounded-full bg-butter-100 px-3 py-1.5 text-sm font-semibold text-ink-700">고친 내용이 있어요 · 다시 제출하세요</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-mint-100 px-3 py-1.5 text-sm font-bold text-mint-700">
      <Icon name="check" size={16} strokeWidth={3} /> 제출 완료
    </span>
  );

  const canUndo = opsRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  const toolBtn = (active: boolean) =>
    `flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl transition active:scale-95 disabled:opacity-35 ${
      active ? 'bg-brand-500 text-white shadow-md shadow-brand-500/30' : 'bg-white text-ink-600 border border-ink-200'
    }`;

  return (
    <div ref={wrapRef} className={`flex min-h-0 flex-col bg-paper ${big ? 'fixed inset-0 z-40' : 'h-full'}`}>
      {/* 상단: 상태 + 제출 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          {headerLeft}
          {statusPill}
        </div>
        <button
          onClick={submit}
          disabled={!loaded || submitting || !canSubmit}
          className="inline-flex h-14 items-center gap-2 rounded-2xl bg-mint-500 px-6 text-lg font-bold text-white shadow-md shadow-mint-500/30 transition active:scale-95 disabled:opacity-45"
        >
          {submitting ? (
            <>
              <span className="h-5 w-5 animate-spin rounded-full border-[3px] border-white/40 border-t-white" /> 보내는 중…
            </>
          ) : (
            <>
              <Icon name="send" /> {hasSubmission ? '다시 제출' : '그림 제출'}
            </>
          )}
        </button>
      </div>
      {!canSubmit && disabledReason && (
        <div className="mx-3 mb-2 rounded-xl bg-butter-100 px-3 py-2 text-sm font-semibold text-ink-700">{disabledReason}</div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3 landscape:flex-row">
        {/* 도구 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-3xl bg-white/80 p-2 shadow-sm ring-1 ring-ink-100 landscape:w-[136px] landscape:flex-col landscape:flex-nowrap landscape:overflow-y-auto">
          <div className="flex gap-2 landscape:flex-wrap landscape:justify-center">
            <button className={toolBtn(tool === 'pen')} onClick={() => setTool('pen')} aria-label="펜">
              <Icon name="pen" size={26} />
            </button>
            <button className={toolBtn(tool === 'eraser')} onClick={() => setTool('eraser')} aria-label="지우개">
              <Icon name="eraser" size={26} />
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-2xl bg-ink-50 p-1 landscape:flex-wrap landscape:justify-center">
            {SIZES.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={`flex h-11 w-11 items-center justify-center rounded-xl ${size === s ? 'bg-white shadow ring-2 ring-brand-400' : ''}`}
                aria-label={`굵기 ${s}`}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: Math.max(4, Math.min(30, s * 0.62)),
                    height: Math.max(4, Math.min(30, s * 0.62)),
                    background: tool === 'eraser' ? '#c7cad1' : color,
                  }}
                />
              </button>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5 landscape:grid-cols-3">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setColor(c);
                  setTool('pen');
                }}
                className={`h-9 w-9 rounded-full ring-offset-2 transition active:scale-90 ${color === c && tool === 'pen' ? 'ring-[3px] ring-brand-500' : 'ring-1 ring-black/10'}`}
                style={{ background: c }}
                aria-label={`색 ${c}`}
              />
            ))}
          </div>

          <div className="ml-auto flex gap-2 landscape:ml-0 landscape:mt-auto landscape:flex-wrap landscape:justify-center">
            <button className={toolBtn(false)} onClick={undo} disabled={!canUndo} aria-label="실행 취소">
              <Icon name="undo" />
            </button>
            <button className={toolBtn(false)} onClick={redo} disabled={!canRedo} aria-label="다시 실행">
              <Icon name="redo" />
            </button>
            <button className={toolBtn(false)} onClick={() => setConfirmClear(true)} aria-label="전체 지우기">
              <Icon name="trash" />
            </button>
            <button className={toolBtn(big)} onClick={toggleBig} aria-label="크게 그리기">
              <Icon name={big ? 'shrink' : 'expand'} />
            </button>
          </div>
        </div>

        {/* 도화지 */}
        <div ref={stageRef} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
          <div className="relative overflow-hidden rounded-xl shadow-lg ring-1 ring-ink-200">
            <canvas ref={baseRef} className="block bg-white" />
            <canvas
              ref={liveRef}
              className="canvas-surface absolute inset-0 block"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onContextMenu={(e) => e.preventDefault()}
              style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
            />
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-ink-500">그림판 준비 중…</div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="전체 지우기"
        message="그림을 모두 지울까요? (실수했다면 ‘실행 취소’로 되돌릴 수 있어요)"
        confirmText="모두 지우기"
        danger
        onConfirm={clearAll}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}
