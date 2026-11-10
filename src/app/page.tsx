import Link from 'next/link';
import { CodeEntry } from '@/components/student/CodeEntry';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center gap-10 px-5 py-10">
      <div className="text-center animate-rise">
        <div className="mx-auto mb-5 grid w-fit grid-cols-3 gap-1.5">
          {['bg-peach-200', 'bg-butter-200', 'bg-mint-200', 'bg-brand-200', 'bg-lilac-100', 'bg-sky-100'].map((c, i) => (
            <span key={i} className={`h-7 w-9 rounded-md ${c}`} />
          ))}
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-ink-800 sm:text-5xl">우리반 그림판</h1>
        <p className="mt-3 text-lg text-ink-500">함께 그리고, 함께 감상하는 실시간 협동 그림판</p>
      </div>

      <div className="grid w-full gap-5 md:grid-cols-2">
        <section className="rounded-3xl bg-white p-7 shadow-sm ring-1 ring-ink-100">
          <div className="mb-1 text-sm font-bold text-mint-600">학생</div>
          <h2 className="mb-4 text-2xl font-bold">수업 코드로 들어가기</h2>
          <p className="mb-5 text-ink-500">선생님이 보여주신 QR코드를 찍거나, 6글자 코드를 입력하세요.</p>
          <CodeEntry />
        </section>
        <section className="flex flex-col rounded-3xl bg-white p-7 shadow-sm ring-1 ring-ink-100">
          <div className="mb-1 text-sm font-bold text-brand-600">선생님</div>
          <h2 className="mb-4 text-2xl font-bold">수업방 만들고 진행하기</h2>
          <p className="mb-5 text-ink-500">수업방을 만들고 QR코드를 띄우면 학생들의 그림과 댓글을 실시간으로 볼 수 있어요.</p>
          <div className="mt-auto flex gap-2">
            <Link href="/teacher" className="inline-flex h-14 flex-1 items-center justify-center rounded-2xl bg-brand-500 text-lg font-bold text-white hover:bg-brand-600">
              교사 로그인
            </Link>
            <Link href="/teacher/signup" className="inline-flex h-14 items-center justify-center rounded-2xl border border-ink-200 px-5 font-semibold text-ink-600 hover:bg-ink-50">
              교사 가입
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
