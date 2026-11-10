import { StudentApp } from '@/components/student/StudentApp';

export default async function StudentRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <StudentApp code={decodeURIComponent(code).toUpperCase()} />;
}
