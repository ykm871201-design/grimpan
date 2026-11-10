// 벡터 기반 그림 엔진: 모든 획을 '논리 좌표(1600×1200, 4:3)'로 저장하고
// 화면에는 (CSS 크기 × devicePixelRatio) 해상도로 다시 그려 고해상도 화면에서도 선명합니다.
export const W = 1600;
export const H = 1200;
export const EXPORT_THUMB_W = 480;
export const EXPORT_THUMB_H = 360;

export type Tool = 'pen' | 'eraser';
export interface StrokeOp {
  kind: 'stroke';
  tool: Tool;
  color: string;
  size: number;
  pts: number[]; // [x0,y0,x1,y1,...] 논리 좌표
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

export function drawStroke(ctx: CanvasRenderingContext2D, s: StrokeOp) {
  const color = s.tool === 'eraser' ? '#ffffff' : s.color;
  const p = s.pts;
  const n = p.length / 2;
  if (n === 0) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], s.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (n === 2) {
    ctx.lineTo(p[2], p[3]);
  } else {
    // 중점 2차 곡선으로 부드럽게
    for (let i = 1; i < n - 1; i++) {
      const x = p[i * 2], y = p[i * 2 + 1];
      const mx = (x + p[i * 2 + 2]) / 2, my = (y + p[i * 2 + 3]) / 2;
      ctx.quadraticCurveTo(x, y, mx, my);
    }
    ctx.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
  }
  ctx.stroke();
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
