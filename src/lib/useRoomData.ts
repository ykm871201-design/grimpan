'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Artwork, Comment, Participant, Room } from './types';

export type ConnStatus = 'connecting' | 'online' | 'offline';

interface Options {
  role: 'teacher' | 'student';
  /** 학생일 때 내 participant id (Presence 로 '접속 중' 표시) */
  myParticipantId?: string | null;
}

function upsert<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  if (i === -1) return [...list, row];
  const next = list.slice();
  next[i] = row;
  return next;
}
function remove<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((x) => x.id !== id);
}

/**
 * 수업방의 모든 데이터를 불러오고 Supabase Realtime 으로 실시간 동기화합니다.
 * - postgres_changes: rooms / participants / artworks / comments (RLS 가 적용되어 권한 있는 행만 수신)
 * - presence: 현재 접속 중인 학생
 * - 재연결 · 온라인 복귀 · 화면 복귀 시 전체 데이터를 다시 불러와 빠진 이벤트를 복구
 */
export function useRoomData(sb: SupabaseClient | null, roomId: string | null, opts: Options) {
  const { role, myParticipantId } = opts;
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [channelKey, setChannelKey] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const myPidRef = useRef(myParticipantId);
  myPidRef.current = myParticipantId;
  const loadSeq = useRef(0);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const reload = useCallback(async () => {
    if (!sb || !roomId) return;
    const seq = ++loadSeq.current;
    const [r, p, a, c] = await Promise.all([
      sb.from('rooms').select('*').eq('id', roomId).maybeSingle(),
      sb.from('participants').select('*').eq('room_id', roomId).order('student_number'),
      sb.from('artworks').select('*').eq('room_id', roomId),
      sb.from('comments').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(2000),
    ]);
    if (seq !== loadSeq.current) return; // 더 최신 요청이 있음
    const err = r.error || p.error || a.error || c.error;
    if (err) {
      setLoadError(err.message);
      return;
    }
    setLoadError(null);
    roomRef.current = (r.data as Room) ?? null;
    setRoom((r.data as Room) ?? null);
    setParticipants((p.data as Participant[]) ?? []);
    setArtworks((a.data as Artwork[]) ?? []);
    setComments((c.data as Comment[]) ?? []);
    setLoaded(true);
  }, [sb, roomId]);

  const scheduleReload = useCallback(
    (ms = 250) => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      // 35명이 동시에 다시 불러오지 않도록 약간의 무작위 지연
      reloadTimer.current = setTimeout(() => void reload(), ms + Math.random() * 400);
    },
    [reload],
  );

  useEffect(() => {
    if (!sb || !roomId) return;
    let disposed = false;
    setStatus('connecting');
    void reload();

    const presenceKey = role === 'teacher' ? `teacher-${Math.random().toString(36).slice(2)}` : (myPidRef.current ?? `anon-${Math.random().toString(36).slice(2)}`);
    const ch = sb.channel(`room:${roomId}`, { config: { presence: { key: presenceKey } } });
    channelRef.current = ch;

    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (payload) => {
      if (payload.eventType === 'DELETE') {
        roomRef.current = null;
        setRoom(null);
        return;
      }
      const next = payload.new as Room;
      const prev = roomRef.current;
      roomRef.current = next;
      setRoom(next);
      // 교사가 숨김/삭제 처리 → RLS 때문에 학생에게는 변경 이벤트가 오지 않으므로 목록을 다시 불러옴
      if (role === 'student' && prev && prev.moderation_rev !== next.moderation_rev) scheduleReload(150);
    });

    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` }, (payload) => {
      if (payload.eventType === 'DELETE') setParticipants((l) => remove(l, (payload.old as { id: string }).id));
      else setParticipants((l) => upsert(l, payload.new as Participant).sort((x, y) => x.student_number - y.student_number));
    });

    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'artworks', filter: `room_id=eq.${roomId}` }, (payload) => {
      if (payload.eventType === 'DELETE') {
        setArtworks((l) => remove(l, (payload.old as { id: string }).id));
        return;
      }
      const row = payload.new as Artwork;
      if (role === 'student' && !row.is_visible && row.participant_id !== myPidRef.current) {
        setArtworks((l) => remove(l, row.id));
      } else {
        setArtworks((l) => upsert(l, row));
      }
    });

    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `room_id=eq.${roomId}` }, (payload) => {
      if (payload.eventType === 'DELETE') {
        setComments((l) => remove(l, (payload.old as { id: string }).id));
        return;
      }
      const row = payload.new as Comment;
      if (role === 'student' && row.is_hidden) {
        setComments((l) => remove(l, row.id));
        return;
      }
      setComments((l) => {
        const exists = l.some((x) => x.id === row.id);
        const next = exists ? l.map((x) => (x.id === row.id ? row : x)) : [row, ...l];
        return exists ? next : next.sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
      });
    });

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ role: string; pid?: string }>();
      const ids = new Set<string>();
      Object.values(state).forEach((metas) =>
        metas.forEach((m) => {
          if (m.role === 'student' && m.pid) ids.add(m.pid);
        }),
      );
      setOnlineIds(ids);
    });

    ch.subscribe(async (st) => {
      if (disposed) return;
      if (st === 'SUBSCRIBED') {
        setStatus('online');
        // (재)연결될 때마다 최신 데이터로 화면 복구
        void reload();
        if (role === 'student' && myPidRef.current) {
          await ch.track({ role: 'student', pid: myPidRef.current, at: Date.now() });
        } else if (role === 'teacher') {
          await ch.track({ role: 'teacher', at: Date.now() });
        }
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
        setStatus('offline');
      }
    });

    const onOnline = () => {
      // 브라우저가 다시 온라인이 되면 채널을 새로 만들어 확실히 재연결
      setChannelKey((k) => k + 1);
    };
    const onOffline = () => setStatus('offline');
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        scheduleReload(0);
        if (ch.state !== 'joined' && ch.state !== 'joining') setChannelKey((k) => k + 1);
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);

    // 감시: 30초마다 채널 상태 확인 (태블릿 절전 후 복귀 등)
    const watchdog = setInterval(() => {
      if (ch.state === 'errored' || ch.state === 'closed') setChannelKey((k) => k + 1);
    }, 30000);

    return () => {
      disposed = true;
      clearInterval(watchdog);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      void sb.removeChannel(ch);
      channelRef.current = null;
    };
  }, [sb, roomId, role, myParticipantId, channelKey, reload, scheduleReload]);

  const participantById = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);
  const artworkById = useMemo(() => new Map(artworks.map((a) => [a.id, a])), [artworks]);
  const artworkByParticipant = useMemo(() => new Map(artworks.map((a) => [a.participant_id, a])), [artworks]);
  const commentCount = useMemo(() => {
    const m = new Map<string, number>();
    comments.forEach((c) => {
      if (!c.is_hidden) m.set(c.artwork_id, (m.get(c.artwork_id) ?? 0) + 1);
    });
    return m;
  }, [comments]);

  return {
    room, setRoom, participants, artworks, setArtworks, comments, setComments,
    status, loaded, loadError, reload, onlineIds,
    participantById, artworkById, artworkByParticipant, commentCount,
  };
}

export type RoomData = ReturnType<typeof useRoomData>;
