'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import {
  BRUSHES, COLORS, ERASER_SIZES, H, PALETTE, PALETTE_COLS, SIZES, W, blobToImage, drawStroke, exportImages, isBlank, renderOps,
  type Brush, type Op, type StrokeOp, type Tool,
} from './engine';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/Modal';
import { toggleFullscreen, isFullscreen } from '@/lib/fullscreen';

const BRUSH_ICON: Record<Brush, IconName> = {
  pen: 'pen', brush: 'brush', crayon: 'crayon', marker: 'marker', spray: 'spray', rainbow: 'rainbow',
};
const RAINBOW_BG = 'linear-gradient(90deg, #ef4444, #f97316, #facc15, #22c55e, #38bdf8, #8b5cf6)';

/** 붓 고르기 창의 미리보기: 실제 그림 엔진으로 물결선을 그려 보여 줌 */
function BrushPreview({ brush, color, size }: { brush: Brush; color: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const LW = 300, LH = 90;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = c.clientWidth || 240;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round((cssW * LH * dpr) / LW);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(c.width / LW, 0, 0, c.width / LW, 0, 0);
    const pts: number[] = [];
    // 처음엔 천천히(촘촘), 갈수록 빠르게(성기게) → 붓 굵기 변화가 보이도록
    for (let x = 24, step = 2; x <= 276; x += step, step = Math.min(14, step * 1.06)) pts.push(x, 45 + 22 * Math.sin((x - 24) / 40));
    drawStroke(ctx, { kind: 'stroke', tool: 'pen', brush, color, size: Math.min(24, Math.max(10, size)), pts, seed: 7 });
  }, [brush, color, size]);
  return <canvas ref={ref} className="block aspect-[10/3] w-full rounded-xl bg-white ring-1 ring-ink-100" aria-hidden="true" />;
}

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
  const [brush, setBrush] = useState<Brush>('pen');
  const [brushOpen, setBrushOpen] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [eraserSize, setEraserSize] = useState(ERASER_SIZES[1]);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
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
    const op: StrokeOp = {
      kind: 'stroke',
      tool,
      color,
      size: tool === 'eraser' ? eraserSize : size,
      pts: [x, y],
    };
    if (tool === 'pen' && brush !== 'pen') {
      op.brush = brush;
      if (brush === 'spray') op.seed = Math.floor(Math.random() * 2147483647);
      // 붓 + 스타일러스(애플펜슬·S펜)는 누르는 힘으로 굵기 조절
      if (brush === 'brush' && e.pointerType === 'pen' && e.pressure > 0) op.pr = [e.pressure];
    }
    curRef.current = op;
    scheduleLive();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== e.pointerId || !curRef.current) return;
    e.preventDefault();
    const native = e.nativeEvent as PointerEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native];
    const pts = curRef.current.pts;
    const pr = curRef.current.pr;
    for (const ev of events.length ? events : [native]) {
      const [x, y] = toLogical(ev);
      const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
      if (Math.abs(x - lx) + Math.abs(y - ly) < 1.2) continue;
      pts.push(x, y);
      if (pr) pr.push(ev.pressure > 0 ? ev.pressure : pr[pr.length - 1]);
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

  const pickColor = (c: string) => {
    setColor(c);
    setTool('pen');
    if (brush === 'rainbow') setBrush('pen'); // 무지개는 색을 고를 수 없으므로 고른 색이 바로 나오게
  };
  const pickBrush = (b: Brush) => {
    setBrush(b);
    setTool('pen');
    setBrushOpen(false);
  };
  /** 지우개를 쓰다가 누르면 붓으로 돌아오고, 이미 붓이면 붓 고르기 창을 엶 */
  const onBrushButton = () => {
    if (tool !== 'pen') setTool('pen');
    else setBrushOpen(true);
  };
  const brushInfo = BRUSHES.find((b) => b.key === brush)!;
  /** 팔레트에서 고른 색은 '최근 색'에 남겨 다시 쉽게 고를 수 있게 합니다. */
  const rememberColor = (c: string) => {
    if (COLORS.includes(c)) return;
    setRecentColors((prev) => [c, ...prev.filter((x) => x !== c)].slice(0, 8));
  };
  const customActive = tool === 'pen' && !COLORS.includes(color);
  const closePalette = () => {
    rememberColor(color);
    setPaletteOpen(false);
  };
  useEffect(() => {
    if (!paletteOpen && !brushOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPaletteOpen(false);
      setBrushOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, brushOpen]);

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
            <button
              className={`relative flex-col gap-0.5 ${toolBtn(tool === 'pen')}`}
              onClick={onBrushButton}
              aria-label={`붓 고르기 (지금: ${brushInfo.label})`}
              title="붓 고르기"
            >
              <Icon name={BRUSH_ICON[brush]} size={22} />
              <span className="text-[11px] font-bold leading-none">{brushInfo.label}</span>
              <span
                className={`absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black shadow ${tool === 'pen' ? 'bg-white text-brand-600' : 'bg-brand-500 text-white'}`}
                aria-hidden="true"
              >
                ▾
              </span>
            </button>
            <button className={toolBtn(tool === 'eraser')} onClick={() => setTool('eraser')} aria-label="지우개">
              <Icon name="eraser" size={26} />
            </button>
          </div>

          <div className="flex flex-col items-center gap-1 rounded-2xl bg-ink-50 p-1">
            <span className="px-1 text-xs font-bold text-ink-500">{tool === 'eraser' ? '지우개 크기' : '굵기'}</span>
            <div className="flex items-center gap-1 landscape:flex-wrap landscape:justify-center">
              {tool === 'eraser'
                ? ERASER_SIZES.map((s, i) => {
                    const d = [8, 12, 17, 23, 30][i];
                    return (
                      <button
                        key={s}
                        onClick={() => setEraserSize(s)}
                        className={`flex h-11 w-11 items-center justify-center rounded-xl ${eraserSize === s ? 'bg-white shadow ring-2 ring-brand-400' : ''}`}
                        aria-label={`지우개 크기 ${i + 1}`}
                      >
                        <span className="rounded-full border-2 border-dashed border-ink-400 bg-white" style={{ width: d, height: d }} />
                      </button>
                    );
                  })
                : SIZES.map((s) => (
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
                          background: brush === 'rainbow' ? RAINBOW_BG : color,
                          opacity: brush === 'marker' ? 0.5 : 1,
                        }}
                      />
                    </button>
                  ))}
            </div>
          </div>

          <div className="grid grid-cols-8 gap-1.5 landscape:grid-cols-3">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => pickColor(c)}
                className={`h-9 w-9 rounded-full ring-offset-2 transition active:scale-90 ${color === c && tool === 'pen' ? 'ring-[3px] ring-brand-500' : 'ring-1 ring-black/10'}`}
                style={{ background: c }}
                aria-label={`색 ${c}`}
              />
            ))}
            <button
              onClick={() => setPaletteOpen(true)}
              className={`flex h-9 w-9 items-center justify-center rounded-full ring-offset-2 transition active:scale-90 ${customActive ? 'ring-[3px] ring-brand-500' : ''}`}
              style={{ background: 'conic-gradient(#ef4444, #f97316, #facc15, #22c55e, #38bdf8, #3b5bdb, #8b5cf6, #ec4899, #ef4444)' }}
              aria-label="색 더 보기"
              title="색 더 보기"
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-ink-700 ring-1 ring-black/10"
                style={customActive ? { background: color } : undefined}
              >
                {!customActive && <Icon name="plus" size={14} strokeWidth={3} />}
              </span>
            </button>
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

      {brushOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-3 animate-fade-in"
          onPointerDown={(e) => e.target === e.currentTarget && setBrushOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="붓 고르기"
        >
          <div className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl animate-pop-in">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600"><Icon name="brush" /></span>
              <h2 className="flex-1 text-xl font-extrabold">붓 고르기</h2>
              <button onClick={() => setBrushOpen(false)} className="h-12 rounded-2xl bg-ink-100 px-5 text-lg font-bold text-ink-700 active:scale-95">
                닫기
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BRUSHES.map((b) => {
                const on = brush === b.key && tool === 'pen';
                return (
                  <button
                    key={b.key}
                    onClick={() => pickBrush(b.key)}
                    className={`flex flex-col gap-1.5 rounded-2xl p-2 text-left transition active:scale-95 ${on ? 'bg-brand-50 ring-[3px] ring-brand-500' : 'bg-ink-50 ring-1 ring-ink-100'}`}
                    aria-label={`붓 ${b.label}`}
                    aria-pressed={on}
                  >
                    <BrushPreview brush={b.key} color={color} size={size} />
                    <span className="flex items-center gap-1.5 px-1 text-lg font-extrabold text-ink-800">
                      <Icon name={BRUSH_ICON[b.key]} size={20} /> {b.label}
                    </span>
                    <span className="px-1 text-sm leading-snug text-ink-500">{b.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {paletteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-3 animate-fade-in"
          onPointerDown={(e) => e.target === e.currentTarget && closePalette()}
          role="dialog"
          aria-modal="true"
          aria-label="색 고르기"
        >
          <div className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl animate-pop-in">
            <div className="flex items-center gap-3">
              <span className="h-10 w-10 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: color }} />
              <h2 className="flex-1 text-xl font-extrabold">색 고르기</h2>
              <button
                onClick={closePalette}
                className="h-12 rounded-2xl bg-brand-500 px-5 text-lg font-bold text-white active:scale-95"
              >
                다 골랐어요
              </button>
            </div>

            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${PALETTE_COLS}, minmax(0, 1fr))` }}
            >
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => pickColor(c)}
                  className={`aspect-square w-full rounded-lg transition active:scale-90 ${color === c ? 'ring-[3px] ring-brand-500 ring-offset-2' : 'ring-1 ring-black/10'}`}
                  style={{ background: c }}
                  aria-label={`팔레트 색 ${c}`}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex h-12 cursor-pointer items-center gap-2 rounded-2xl border-2 border-ink-200 bg-ink-50 pl-2 pr-4 font-bold text-ink-700">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => pickColor(e.target.value)}
                  className="h-9 w-9 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                  aria-label="원하는 색 직접 만들기"
                />
                원하는 색 직접 만들기
              </label>
              {recentColors.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-bold text-ink-500">최근 쓴 색</span>
                  {recentColors.map((c) => (
                    <button
                      key={c}
                      onClick={() => pickColor(c)}
                      className={`h-9 w-9 rounded-full transition active:scale-90 ${color === c ? 'ring-[3px] ring-brand-500 ring-offset-2' : 'ring-1 ring-black/10'}`}
                      style={{ background: c }}
                      aria-label={`최근 색 ${c}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
