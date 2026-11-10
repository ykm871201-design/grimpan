'use client';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Kind = 'info' | 'success' | 'error';
interface ToastItem { id: number; text: string; kind: Kind }
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 5000 : 2800);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-lg rounded-2xl px-5 py-3 text-center text-[15px] font-semibold shadow-lg animate-pop-in ${
              t.kind === 'success' ? 'bg-mint-500 text-white' : t.kind === 'error' ? 'bg-peach-500 text-white' : 'bg-ink-800 text-white'
            }`}
            role="status"
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
