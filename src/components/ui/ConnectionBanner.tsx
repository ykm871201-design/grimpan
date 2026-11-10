'use client';
import type { ConnStatus } from '@/lib/useRoomData';
import { Icon } from './Icon';

export function ConnectionBanner({ status, onRetry }: { status: ConnStatus; onRetry?: () => void }) {
  if (status === 'online') return null;
  return (
    <div className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold ${status === 'offline' ? 'bg-peach-100 text-peach-700' : 'bg-butter-100 text-ink-700'}`} role="status">
      {status === 'offline' ? <Icon name="wifiOff" size={18} /> : <span className="h-2 w-2 animate-pulse rounded-full bg-butter-400" />}
      {status === 'offline' ? '인터넷 연결이 끊겼어요. 다시 연결되면 자동으로 최신 내용을 불러와요.' : '연결하는 중…'}
      {status === 'offline' && onRetry && (
        <button onClick={onRetry} className="ml-2 rounded-lg bg-white/70 px-2 py-1 text-xs">
          다시 시도
        </button>
      )}
    </div>
  );
}

export function StatusDot({ status }: { status: ConnStatus }) {
  const c = status === 'online' ? 'bg-mint-500' : status === 'offline' ? 'bg-peach-500' : 'bg-butter-400 animate-pulse';
  const t = status === 'online' ? '실시간 연결됨' : status === 'offline' ? '연결 끊김' : '연결 중';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500" title={t}>
      <span className={`h-2.5 w-2.5 rounded-full ${c}`} />
      {t}
    </span>
  );
}
