'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Room } from '@/lib/types';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { downloadBlob } from '@/lib/results';
import { safeFileName } from '@/lib/format';

export function joinUrl(code: string) {
  return `${window.location.origin}/join/${code}`;
}

export function QrModal({ room, open, onClose }: { room: Room; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!open) return;
    const u = joinUrl(room.code);
    setUrl(u);
    QRCode.toDataURL(u, { width: 1000, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1b1f29', light: '#ffffff' } }).then(setDataUrl);
  }, [open, room.code]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('접속 주소를 복사했어요.', 'success');
    } catch {
      toast('복사하지 못했어요. 주소를 직접 선택해 복사해 주세요.', 'error');
    }
  };

  const download = async () => {
    if (!dataUrl) return;
    // 인쇄·게시용: 제목 + QR + 코드 + 주소를 한 장에
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 1500;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#2a2f3d';
    ctx.textAlign = 'center';
    ctx.font = 'bold 56px "Pretendard Variable", Pretendard, sans-serif';
    ctx.fillText(room.title.slice(0, 26), 600, 110);
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    ctx.drawImage(img, 150, 170, 900, 900);
    ctx.font = 'bold 120px ui-monospace, Menlo, monospace';
    ctx.fillText(room.code.split('').join(' '), 600, 1250);
    ctx.fillStyle = '#737a8e';
    ctx.font = '36px "Pretendard Variable", Pretendard, sans-serif';
    ctx.fillText(url, 600, 1340);
    c.toBlob((b) => b && downloadBlob(b, `QR_${room.code}_${safeFileName(room.title)}.png`), 'image/png');
  };

  return (
    <Modal open={open} onClose={onClose} full title={<span>학생 접속 QR코드</span>}>
      <div className="flex h-full flex-col items-center justify-center gap-5 p-6 lg:flex-row lg:gap-14">
        <div className="aspect-square h-[min(70vh,80vw)] max-h-[760px] rounded-3xl bg-white p-4 shadow-lg ring-1 ring-ink-100">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrl} alt="QR코드" className="h-full w-full [image-rendering:pixelated]" />
          ) : (
            <div className="h-full w-full animate-pulse rounded-2xl bg-ink-100" />
          )}
        </div>
        <div className="flex flex-col items-center gap-4 lg:items-start">
          <div className="text-xl font-bold text-ink-500">{room.title}</div>
          <div className="text-lg font-semibold text-ink-500">태블릿 카메라로 QR코드를 찍거나, 코드를 입력하세요</div>
          <div className="font-mono text-7xl font-extrabold tracking-[0.18em] text-ink-800 lg:text-8xl">{room.code}</div>
          <div className="max-w-md break-all rounded-xl bg-ink-50 px-4 py-2 font-mono text-ink-600">{url}</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={copy} className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand-500 px-5 font-bold text-white"><Icon name="copy" size={18} /> 주소 복사</button>
            <button onClick={download} className="inline-flex h-12 items-center gap-2 rounded-xl border border-ink-200 px-5 font-bold text-ink-700"><Icon name="download" size={18} /> QR 이미지 저장</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
