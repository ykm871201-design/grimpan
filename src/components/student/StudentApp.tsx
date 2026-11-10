'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureStudentSession, getStudentClient } from '@/lib/supabase/student-client';
import { hasSupabaseEnv } from '@/lib/supabase/env';
import { friendlyError, withRetry } from '@/lib/errors';
import { BUCKET, type Artwork, type Participant, type RoomBasic } from '@/lib/types';
import { useRoomData } from '@/lib/useRoomData';
import { DrawingBoard } from '@/components/drawing/DrawingBoard';
import { ConnectionBanner, StatusDot } from '@/components/ui/ConnectionBanner';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icon';
import { JoinForm } from './JoinForm';
import { SharingBoard } from './SharingBoard';
import { PhaseTransition } from './PhaseTransition';

type Stage = { k: 'loading'; msg?: string } | { k: 'error'; msg: string } | { k: 'join' } | { k: 'room' };

export function StudentApp({ code }: { code: string }) {
  const [sb] = useState<SupabaseClient | null>(() => (hasSupabaseEnv() ? getStudentClient() : null));
  const [stage, setStage] = useState<Stage>({ k: 'loading' });
  const [uid, setUid] = useState<string | null>(null);
  const [basic, setBasic] = useState<RoomBasic | null>(null);
  const [me, setMe] = useState<Participant | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!sb) {
      setStage({ k: 'error', msg: 'Supabase 환경변수가 설정되지 않았어요. (README 의 환경변수 설정 참고)' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setStage({ k: 'loading', msg: '접속하는 중…' });
        const id = await withRetry(() => ensureStudentSession(sb), 4, 1500);
        if (cancelled) return;
        setUid(id);
        const { data, error } = await withRetry(async () => {
          const r = await sb.rpc('get_room_by_code', { p_code: code });
          if (r.error) throw r.error;
          return r;
        });
        if (error) throw error;
        const r = (data as RoomBasic[] | null)?.[0];
        if (!r) {
          setStage({ k: 'error', msg: `‘${code}’ 수업방을 찾을 수 없어요. 코드를 다시 확인해 주세요.` });
          return;
        }
        setBasic(r);
        const mine = await sb.from('participants').select('*').eq('room_id', r.id).eq('user_id', id).maybeSingle();
        if (cancelled) return;
        if (mine.data) {
          setMe(mine.data as Participant);
          setStage({ k: 'room' });
        } else if (r.phase === 'closed') {
          setStage({ k: 'error', msg: '이미 끝난 수업이에요.' });
        } else {
          setStage({ k: 'join' });
        }
      } catch (e) {
        if (!cancelled) setStage({ k: 'error', msg: friendlyError(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sb, code, attempt]);

  if (stage.k === 'loading')
    return (
      <Center>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-mint-200 border-t-mint-500" />
        <p className="mt-4 text-lg text-ink-500">{stage.msg ?? '불러오는 중…'}</p>
      </Center>
    );
  if (stage.k === 'error')
    return (
      <Center>
        <div className="mb-4 text-5xl">🙈</div>
        <p className="max-w-md text-center text-lg font-semibold text-ink-700">{stage.msg}</p>
        <div className="mt-6 flex gap-2">
          <button className="h-12 rounded-xl bg-mint-500 px-6 font-bold text-white" onClick={() => setAttempt((a) => a + 1)}>
            다시 시도
          </button>
          <a href="/join" className="inline-flex h-12 items-center rounded-xl border border-ink-200 px-5 font-semibold text-ink-600">
            코드 다시 입력
          </a>
        </div>
      </Center>
    );
  if (stage.k === 'join' && sb && basic)
    return (
      <JoinForm
        sb={sb}
        code={code}
        room={basic}
        onJoined={(p) => {
          setMe(p);
          setStage({ k: 'room' });
        }}
      />
    );
  if (stage.k === 'room' && sb && basic && me && uid)
    return (
      <StudentRoom
        sb={sb}
        uid={uid}
        roomId={basic.id}
        me={me}
        onKicked={() => {
          setMe(null);
          setStage({ k: 'join' });
        }}
      />
    );
  return null;
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center px-6">{children}</main>;
}

function StudentRoom({ sb, uid, roomId, me: initialMe, onKicked }: { sb: SupabaseClient; uid: string; roomId: string; me: Participant; onKicked: () => void }) {
  const toast = useToast();
  const data = useRoomData(sb, roomId, { role: 'student', myParticipantId: initialMe.id });
  const { room, loaded, artworks, setArtworks, participantById, status, reload } = data;
  const me = participantById.get(initialMe.id) ?? initialMe;
  const myArtwork: Artwork | undefined = useMemo(() => artworks.find((a) => a.participant_id === initialMe.id), [artworks, initialMe.id]);
  const [editing, setEditing] = useState(false);
  const [transition, setTransition] = useState(false);
  const prevPhase = useRef<string | null>(null);

  // 교사가 '번호 재설정'하면 이 기기 연결이 해제됨
  useEffect(() => {
    if (!loaded) return;
    const row = participantById.get(initialMe.id);
    if (!row || row.user_id !== uid) {
      toast('선생님이 번호를 다시 설정했어요. 번호를 다시 골라 주세요.', 'info');
      onKicked();
    }
  }, [loaded, participantById, initialMe.id, uid, onKicked, toast]);

  // 단계 전환 애니메이션
  useEffect(() => {
    if (!room) return;
    if (prevPhase.current && prevPhase.current !== room.phase && room.phase === 'sharing') {
      setTransition(true);
      setEditing(false);
    } else if (room.phase !== 'sharing') {
      setEditing(false);
      setTransition(false);
    }
    prevPhase.current = room.phase;
  }, [room]);

  // 전환 화면 자동 닫기. room 이 다시 불러와져도(재연결·실시간 갱신) 타이머가 취소되지 않도록 따로 둔다.
  useEffect(() => {
    if (!transition) return;
    const t = setTimeout(() => setTransition(false), 2600);
    return () => clearTimeout(t);
  }, [transition]);

  const canSubmit = !!room && (room.phase === 'drawing' || (room.phase === 'sharing' && room.allow_resubmit_in_sharing));
  const disabledReason = !room
    ? null
    : room.phase === 'closed'
      ? '수업이 끝나서 더 이상 제출할 수 없어요.'
      : room.phase === 'sharing' && !room.allow_resubmit_in_sharing
        ? '지금은 감상 시간이에요.'
        : null;

  const loadServerImage = useCallback(async () => {
    if (!myArtwork) return null;
    const { data: blob } = await sb.storage.from(BUCKET).download(myArtwork.image_path);
    return blob ?? null;
  }, [sb, myArtwork]);

  const onSubmit = async ({ full, thumb }: { full: Blob; thumb: Blob }) => {
    try {
      const base = `${roomId}/${uid}/${Date.now()}`;
      const up = async (path: string, blob: Blob) =>
        withRetry(async () => {
          const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
          if (error && !/exists|duplicate/i.test(error.message)) throw error;
        });
      await up(`${base}-thumb.jpg`, thumb);
      await up(`${base}-full.jpg`, full);
      const res = await withRetry(async () => {
        const r = await sb.rpc('submit_artwork', { p_room_id: roomId, p_image_path: `${base}-full.jpg`, p_thumb_path: `${base}-thumb.jpg` });
        if (r.error) throw r.error;
        return r.data as Artwork;
      });
      setArtworks((l) => {
        const i = l.findIndex((a) => a.id === res.id);
        if (i === -1) return [...l, res];
        const n = l.slice();
        n[i] = res;
        return n;
      });
      toast(res.version > 1 ? '새 그림으로 바꿨어요! ✨' : '제출했어요! 선생님 화면에 올라갔어요 🎉', 'success');
    } catch (e) {
      toast(friendlyError(e), 'error');
      throw e;
    }
  };

  if (!loaded || !room) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center">
        <ConnectionBanner status={status} onRetry={reload} />
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-mint-200 border-t-mint-500" />
      </main>
    );
  }

  const showDrawing = room.phase === 'drawing' || editing;
  const myLabel = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-bold text-ink-700 ring-1 ring-ink-200">
      <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-mint-100 px-1 text-mint-700">{me.student_number}</span>
      {me.nickname}
    </span>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <ConnectionBanner status={status} onRetry={reload} />
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-ink-100 bg-white/70 px-4 py-2 backdrop-blur">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-ink-800">{room.title}</div>
          <div className="text-xs font-semibold text-ink-400">
            {room.phase === 'drawing' ? '🎨 그림 그리기 시간' : room.phase === 'sharing' ? '💬 느낌 나누기 시간' : '🌟 활동 마무리'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          {editing && (
            <button onClick={() => setEditing(false)} className="inline-flex h-10 items-center gap-1 rounded-xl bg-brand-50 px-3 font-semibold text-brand-700">
              <Icon name="back" size={18} /> 감상하러 가기
            </button>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div className={showDrawing ? 'h-full' : 'hidden'}>
          <DrawingBoard
            draftKey={`draft:${roomId}:${initialMe.id}`}
            ready={loaded}
            hasSubmission={!!myArtwork}
            canSubmit={canSubmit}
            disabledReason={disabledReason}
            loadServerImage={loadServerImage}
            onSubmit={onSubmit}
            headerLeft={myLabel}
            onBlankSubmit={() => toast('아직 아무것도 그리지 않았어요. 그림을 그린 뒤 제출해 주세요!', 'info')}
          />
        </div>
        {!showDrawing && (
          <SharingBoard
            sb={sb}
            data={data}
            room={room}
            me={me}
            myArtwork={myArtwork}
            onEditMine={room.phase === 'sharing' && room.allow_resubmit_in_sharing ? () => setEditing(true) : undefined}
          />
        )}
      </div>

      {transition && <PhaseTransition />}
    </div>
  );
}
