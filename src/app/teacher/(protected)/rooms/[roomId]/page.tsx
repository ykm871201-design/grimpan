import { Suspense } from 'react';
import { TeacherRoom } from '@/components/teacher/TeacherRoom';

export default async function Page({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return (
    <Suspense>
      <TeacherRoom roomId={roomId} />
    </Suspense>
  );
}
