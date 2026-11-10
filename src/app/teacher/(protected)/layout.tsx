import { redirect } from 'next/navigation';
import { getTeacherOnServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// 서버에서 교사 여부를 다시 확인 (미들웨어 + 서버 컴포넌트 + DB RLS 3중 보호)
export default async function TeacherProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, teacher } = await getTeacherOnServer();
  if (!user) redirect('/teacher/login');
  if (!teacher) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div>
          <h1 className="mb-2 text-2xl font-bold">교사 계정 정보를 찾을 수 없어요</h1>
          <p className="text-ink-500">Supabase SQL Editor 에서 <code>supabase/schema.sql</code> 을 실행했는지 확인해 주세요.</p>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
