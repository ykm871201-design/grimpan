export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
}
export function pad2(n: number) {
  return String(n).padStart(2, '0');
}
export function safeFileName(s: string) {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
}
export function studentLabel(p?: { student_number: number; nickname: string } | null) {
  if (!p) return '알 수 없음';
  return `${p.student_number}번 ${p.nickname}`;
}
