'use client';
type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export function isFullscreen() {
  const d = document as FsDoc;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}
export async function toggleFullscreen(el?: HTMLElement | null) {
  const d = document as FsDoc;
  try {
    if (isFullscreen()) {
      await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    } else {
      const t = (el ?? document.documentElement) as FsEl;
      await (t.requestFullscreen?.() ?? t.webkitRequestFullscreen?.());
    }
  } catch {
    /* 지원하지 않는 브라우저 */
  }
}
