'use client';
import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
  full = false,
  hideClose = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  full?: boolean;
  hideClose?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/45 p-3 backdrop-blur-[2px] animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`relative flex max-h-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl animate-pop-in ${
          full ? 'h-full w-full' : wide ? 'w-full max-w-5xl' : 'w-full max-w-md'
        }`}
      >
        {(title || !hideClose) && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-100 px-5 py-3">
            <div className="text-lg font-bold text-ink-800">{title}</div>
            {!hideClose && (
              <button onClick={onClose} className="rounded-full p-2 text-ink-500 hover:bg-ink-100" aria-label="닫기">
                <Icon name="close" />
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '확인',
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-5 p-5">
        {message && <div className="text-[15px] leading-relaxed text-ink-600">{message}</div>}
        <div className="flex justify-end gap-2">
          <button className="h-12 rounded-xl px-5 font-semibold text-ink-600 hover:bg-ink-100" onClick={onClose}>
            취소
          </button>
          <button
            className={`h-12 rounded-xl px-6 font-semibold text-white ${danger ? 'bg-peach-500 hover:bg-peach-600' : 'bg-brand-500 hover:bg-brand-600'}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
