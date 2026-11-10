import { CodeEntry } from '@/components/student/CodeEntry';

export default function JoinPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5">
      <h1 className="text-center text-3xl font-extrabold">수업 코드 입력</h1>
      <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink-100">
        <CodeEntry autoFocus />
      </div>
    </main>
  );
}
