import { getTeacherOnServer } from '@/lib/supabase/server';
import type { Room } from '@/lib/types';
import { Dashboard } from '@/components/teacher/Dashboard';

export default async function TeacherHome() {
  const { supabase, teacher } = await getTeacherOnServer();
  const { data: rooms } = await supabase.from('rooms').select('*').order('created_at', { ascending: false });
  const { data: counts } = await supabase.from('artworks').select('room_id');
  const artCount: Record<string, number> = {};
  (counts ?? []).forEach((r: { room_id: string }) => (artCount[r.room_id] = (artCount[r.room_id] ?? 0) + 1));
  return <Dashboard teacherName={teacher?.display_name ?? '선생님'} rooms={(rooms as Room[]) ?? []} artCount={artCount} />;
}
