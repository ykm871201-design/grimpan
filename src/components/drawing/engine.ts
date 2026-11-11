// 벡터 기반 그림 엔진: 모든 획을 '논리 좌표(1600×1200, 4:3)'로 저장하고
// 화면에는 (CSS 크기 × devicePixelRatio) 해상도로 다시 그려 고해상도 화면에서도 선명합니다.
export const W = 1600;
export const H = 1200;
export const EXPORT_THUMB_W = 480;
export const EXPORT_THUMB_H = 360;

export type Tool = 'pen' | 'eraser';
/** 붓 종류 (tool 이 'pen' 일 때만 의미가 있음) */
export type Brush = 'pen' | 'brush' | 'crayon' | 'marker' | 'spray' | 'rainbow';
export interface StrokeOp {
  kind: 'stroke';
  tool: Tool;
  /** 없으면 'pen' (예전 임시 저장 그림 호환) */
  brush?: Brush;
  color: string;
  size: number;
  pts: number[]; // [x0,y0,x1,y1,...] 논리 좌표
  /** 스타일러스 필압(0~1), 점마다 하나. 붓에서만 사용 */
  pr?: number[];
  /** 크레파스·스프레이 무늬를 다시 그려도 똑같이 만들기 위한 씨앗값 */
  seed?: number;
}
export interface ClearOp {
  kind: 'clear';
}
export type Op = StrokeOp | ClearOp;

export const COLORS = [
  '#222222', '#8a8f98', '#ef4444', '#f97316', '#facc15', '#84cc16', '#22c55e',
  '#14b8a6', '#38bdf8', '#3b5bdb', '#8b5cf6', '#ec4899', '#92400e', '#f6c9a8',
];
export const SIZES = [4, 9, 16, 28, 48];

export const BRUSHES: { key: Brush; label: string; desc: string }[] = [
  { key: 'pen', label: '펜', desc: '깔끔한 선' },
  { key: 'brush', label: '붓', desc: '천천히 그리면 굵게, 빠르게 그리면 가늘게' },
  { key: 'crayon', label: '크레파스', desc: '거칠거칠한 느낌' },
  { key: 'marker', label: '형광펜', desc: '밑그림이 비치는 반투명' },
  { key: 'spray', label: '스프레이', desc: '톡톡 뿌린 점' },
  { key: 'rainbow', label: '무지개', desc: '그릴수록 색이 바뀌어요' },
];
/** 지우개 크기 (논리 좌표 기준, 도화지 가로 1600) */
export const ERASER_SIZES = [12, 24, 40, 64, 100];

function hslToHex(h: number, s: number, l: number) {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** '색 더 보기' 팔레트: 열 = 색 계열, 행 = 밝은 색 → 어두운 색 */
const HUES: { h: number; s: number }[] = [
  { h: 0, s: 85 }, { h: 18, s: 90 }, { h: 32, s: 95 }, { h: 48, s: 95 }, { h: 62, s: 85 },
  { h: 90, s: 70 }, { h: 130, s: 60 }, { h: 165, s: 65 }, { h: 192, s: 80 }, { h: 215, s: 80 },
  { h: 240, s: 65 }, { h: 268, s: 65 }, { h: 295, s: 60 }, { h: 330, s: 75 }, { h: 25, s: 45 },
];
const LIGHTS = [92, 82, 70, 58, 47, 37, 27, 18];
export const PALETTE_COLS = HUES.length + 1; // + 회색 계열
export const PALETTE: string[] = LIGHTS.flatMap((l, row) => [
  ...HUES.map(({ h, s }) => hslToHex(h, s, l)),
  hslToHex(0, 0, Math.round(100 - (row * 100) / (LIGHTS.length - 1))),
]);

/** 같은 씨앗값이면 항상 같은 난수열 → 다시 그려도(실행 취소·제출) 모양이 똑같음 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 점들을 '중점 2차 곡선' 조각으로 나눕니다. (펜과 같은 부드러운 경로)
 * cb(시작x, 시작y, 조절x, 조절y, 끝x, 끝y, 기준점 번호)
 */
function eachPiece(p: number[], cb: (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, i: number) => void) {
  const n = p.length / 2;
  if (n < 2) return;
  if (n === 2) {
    cb(p[0], p[1], (p[0] + p[2]) / 2, (p[1] + p[3]) / 2, p[2], p[3], 1);
    return;
  }
  let sx = p[0], sy = p[1];
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2], y = p[i * 2 + 1];
    const mx = (x + p[i * 2 + 2]) / 2, my = (y + p[i * 2 + 3]) / 2;
    cb(sx, sy, x, y, mx, my, i);
    sx = mx;
    sy = my;
  }
  const lx = p[(n - 1) * 2], ly = p[(n - 1) * 2 + 1];
  cb(sx, sy, (sx + lx) / 2, (sy + ly) / 2, lx, ly, n - 1);
}

function tracePath(ctx: CanvasRenderingContext2D, p: number[]) {
  const n = p.length / 2;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (n === 2) {
    ctx.lineTo(p[2], p[3]);
    return;
  }
  // 중점 2차 곡선으로 부드럽게
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2], y = p[i * 2 + 1];
    const mx = (x + p[i * 2 + 2]) / 2, my = (y + p[i * 2 + 3]) / 2;
    ctx.quadraticCurveTo(x, y, mx, my);
  }
  ctx.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
}

/** 크레파스 결: 색마다 한 번 만든 뒤 재사용 */
const grainCache = new Map<string, HTMLCanvasElement>();
function crayonGrain(color: string) {
  let c = grainCache.get(color);
  if (c) return c;
  const cell = 2;
  const N = 48;
  c = document.createElement('canvas');
  c.width = c.height = N * cell;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(12345);
  g.fillStyle = color;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const r = rnd();
      // 종이 결처럼 군데군데 비어 있게
      const a = r < 0.22 ? 0 : r < 0.4 ? 0.35 : 0.7 + 0.3 * rnd();
      if (!a) continue;
      g.globalAlpha = a;
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  grainCache.set(color, c);
  return c;
}

/** 붓: 점마다 굵기(0~1배) — 필압이 있으면 필압, 없으면 속도(점 간격)로. 시작·끝은 가늘게 */
function brushWidths(s: StrokeOp) {
  const p = s.pts;
  const n = p.length / 2;
  const out = new Array<number>(n);
  let f = 0.55;
  for (let i = 0; i < n; i++) {
    let target: number;
    if (s.pr && s.pr.length === n) {
      target = 0.2 + 0.95 * Math.min(1, Math.max(0, s.pr[i]));
    } else {
      const d = i === 0 ? 0 : Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      target = Math.min(1.15, Math.max(0.35, 1.2 - d / 60));
    }
    f = i === 0 ? target : f * 0.75 + target * 0.25;
    out[i] = f;
  }
  const tin = Math.min(5, n - 1), tout = Math.min(7, n - 1);
  for (let i = 0; i < n; i++) {
    let k = 1;
    if (tin > 0 && i < tin) k = Math.min(k, 0.35 + 0.65 * (i / tin));
    if (tout > 0 && n - 1 - i < tout) k = Math.min(k, 0.15 + 0.85 * ((n - 1 - i) / tout));
    out[i] *= k;
  }
  return out;
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: StrokeOp) {
  const p = s.pts;
  const n = p.length / 2;
  if (n === 0) return;
  const brush: Brush = s.tool === 'eraser' ? 'pen' : (s.brush ?? 'pen');
  const color = s.tool === 'eraser' ? '#ffffff' : s.color;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (brush === 'spray') {
    const rnd = mulberry32(s.seed ?? 1);
    const R = s.size * 1.1 + 8; // 뿌려지는 범위(반지름)
    const dot = Math.max(1.4, s.size * 0.05);
    ctx.fillStyle = color;
    ctx.beginPath();
    const spray = (x: number, y: number, count: number) => {
      for (let k = 0; k < count; k++) {
        const r = R * Math.sqrt(rnd());
        const t = rnd() * Math.PI * 2;
        const dx = x + r * Math.cos(t), dy = y + r * Math.sin(t);
        ctx.moveTo(dx + dot, dy);
        ctx.arc(dx, dy, dot * (0.6 + 0.8 * rnd()), 0, Math.PI * 2);
      }
    };
    spray(p[0], p[1], Math.ceil(R * 0.6));
    for (let i = 1; i < n; i++) {
      const x0 = p[i * 2 - 2], y0 = p[i * 2 - 1], x1 = p[i * 2], y1 = p[i * 2 + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const count = Math.min(400, Math.ceil(len * R * 0.02));
      for (let k = 0; k < count; k++) {
        const t = rnd();
        spray(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1);
      }
    }
    ctx.fill();
    ctx.restore();
    return;
  }

  if (brush === 'brush' || brush === 'rainbow') {
    const w = brush === 'brush' ? brushWidths(s) : null;
    const width = (i: number) => (w ? Math.max(0.8, s.size * 1.35 * w[i]) : s.size);
    let dist = 0;
    const hue = (d: number) => `hsl(${Math.round((d * 0.35) % 360)}, 90%, 55%)`;
    if (n === 1) {
      ctx.fillStyle = brush === 'rainbow' ? hue(0) : color;
      ctx.beginPath();
      ctx.arc(p[0], p[1], (brush === 'brush' ? s.size * 0.6 : s.size) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.strokeStyle = color;
    eachPiece(p, (x0, y0, cx, cy, x1, y1, i) => {
      if (brush === 'rainbow') {
        dist += Math.hypot(x1 - x0, y1 - y0);
        ctx.strokeStyle = hue(dist);
      }
      ctx.lineWidth = width(i);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
      ctx.stroke();
    });
    ctx.restore();
    return;
  }

  // 펜 · 지우개 · 크레파스 · 형광펜: 경로 하나로 그림
  let paint: string | CanvasPattern = color;
  let lw = s.size;
  if (brush === 'crayon') {
    paint = ctx.createPattern(crayonGrain(color), 'repeat') ?? color;
    lw = s.size * 1.2;
  } else if (brush === 'marker') {
    ctx.globalAlpha = 0.4;
    lw = s.size * 1.8;
  }
  ctx.strokeStyle = paint;
  ctx.fillStyle = paint;
  ctx.lineWidth = lw;
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], lw / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    tracePath(ctx, p);
    ctx.stroke();
  }
  ctx.restore();
}

/** ops 를 처음부터 다시 그립니다. 마지막 '전체 지우기' 이후만 그리면 됩니다. */
export function renderOps(
  ctx: CanvasRenderingContext2D,
  ops: Op[],
  bg: CanvasImageSource | null,
  scale: number,
  pixelW: number,
  pixelH: number,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pixelW, pixelH);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  let start = 0;
  let useBg = true;
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i].kind === 'clear') {
      start = i + 1;
      useBg = false;
      break;
    }
  }
  if (useBg && bg) ctx.drawImage(bg, 0, 0, W, H);
  for (let i = start; i < ops.length; i++) {
    const op = ops[i];
    if (op.kind === 'stroke') drawStroke(ctx, op);
  }
}

export function isBlank(ops: Op[], hasBg: boolean) {
  let lastClear = -1;
  for (let i = ops.length - 1; i >= 0; i--) if (ops[i].kind === 'clear') { lastClear = i; break; }
  const strokesAfter = ops.slice(lastClear + 1).some((o) => o.kind === 'stroke' && o.tool === 'pen');
  if (strokesAfter) return false;
  return !(hasBg && lastClear === -1);
}

function canvasToBlob(c: HTMLCanvasElement, type: string, q: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들지 못했어요.'))), type, q),
  );
}

/** 제출용 원본(1600×1200 JPEG) + 갤러리용 썸네일(480×360 JPEG) 생성 */
export async function exportImages(ops: Op[], bg: CanvasImageSource | null) {
  const full = document.createElement('canvas');
  full.width = W;
  full.height = H;
  const fctx = full.getContext('2d')!;
  renderOps(fctx, ops, bg, 1, W, H);
  const thumb = document.createElement('canvas');
  thumb.width = EXPORT_THUMB_W;
  thumb.height = EXPORT_THUMB_H;
  const tctx = thumb.getContext('2d')!;
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(full, 0, 0, EXPORT_THUMB_W, EXPORT_THUMB_H);
  const [fullBlob, thumbBlob] = await Promise.all([
    canvasToBlob(full, 'image/jpeg', 0.88),
    canvasToBlob(thumb, 'image/jpeg', 0.8),
  ]);
  return { full: fullBlob, thumb: thumbBlob };
}

export async function blobToImage(blob: Blob): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fallthrough */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
