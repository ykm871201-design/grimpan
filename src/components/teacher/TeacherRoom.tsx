'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTeacherClient } from '@/lib/supabase/teacher-client';
import { useRoomData } from '@/lib/useRoomData';
import { useSignedUrls } from '@/lib/signedUrls';
import { friendlyError } from '@/lib/errors';
import { toggleFullscreen, isFullscreen } from '@/lib/fullscreen';
import type { Artwork, Comment, Participant, Phase, Room } from '@/lib/types';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
import { ConnectionBanner, StatusDot } from '@/components/ui/ConnectionBanner';
import { useToast } from '@/components/ui/Toast';
import { TeacherGallery, type Slot } from './TeacherGallery';
import { CommentFeed } from './CommentFeed';
import { QrModal } from './QrModal';
import { ArtworkModal } from './ArtworkModal';
import { ManageModal } from './ManageModal';
import { ResultsModal } from './ResultsModal';

type Layout = 'split' | 'gallery' | 'feed';

const PHASES: { key: Phase; label: string; icon: IconName; on: string }[] = [
  { key: 'drawing', label: '그림 그리기', icon: 'brush', on: 'bg-butter-400 text-ink-900 shadow-butter-400/40' },
  { key: 'sharing', label: '느낌 나누기 시작', icon: 'chat', on: 'bg-brand-500 text-white shadow-brand-500/40' },
  { key: 'closed', label: '활동 마무리', icon: 'check', on: 'bg-ink-700 text-white shadow-ink-700/30' },
];

export function TeacherRoom({ roomId }: { roomId: string }) {
  const toast = useToast();
  const params = useSearchParams();
  const [sb] = useState(() => getTeacherClient());
  const data = useRoomData(sb, roomId, { role: 'teacher' });
  const { room, setRoom, participants, artworks, setArtworks, comments, setComments, status, loaded, loadError, reload, onlineIds, participantById, artworkById, artworkByParticipant, commentCount } = data;

  const [showAll, setShowAll] = useState(true);
  const [mosaic, setMosaic] = useState(false);
  const [layout, setLayout] = useState<Layout>('split');
  const [openArt, setOpenArt] = useState<string | null>(null);
  const [qr, setQr] = useState(params.get('qr') === '1');
  const [manage, setManage] = useState(false);
  const [results, setResults] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; message: string; text: string; danger?: boolean; run: () => void }>(null);
  const [fs, setFs] = useState(false);
  // 교사 화면(전자칠판)에서만 그림 가리기 — 학생 화면과는 별개. 새로고침해도 유지되도록 이 기기에 기억
  const coverKey = `grimpan:cover:${roomId}`;
  const [covered, setCoveredState] = useState(false);
  useEffect(() => {
    try {
      setCoveredState(localStorage.getItem(coverKey) === '1');
    } catch {}
  }, [coverKey]);
  const setCovered = (v: boolean) => {
    setCoveredState(v);
    try {
      if (v) localStorage.setItem(coverKey, '1');
      else localStorage.removeItem(coverKey);
    } catch {}
  };
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setFs(isFullscreen());
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      document.removeEventListener('webkitfullscreenchange', on);
    };
  }, []);

  // ---------- 작품 칸 구성 (출석번호 순) ----------
  const slots: Slot[] = useMemo(() => {
    if (!room) return [];
    const byNum = new Map(participants.map((p) => [p.student_number, p]));
    const maxN = Math.max(room.max_students, ...participants.map((p) => p.student_number));
    const out: Slot[] = [];
    for (let n = 1; n <= maxN; n++) {
      const p = byNum.get(n);
      const a = p ? artworkByParticipant.get(p.id) : undefined;
      if (!showAll && !a) continue;
      out.push({ number: n, participant: p, artwork: a });
    }
    return out;
  }, [room, participants, artworkByParticipant, showAll]);

  const thumbUrl = useSignedUrls(sb, artworks.map((a) => a.thumb_path));
  const submitted = artworks.length;
  const onlineCount = participants.filter((p) => onlineIds.has(p.id)).length;

  // ---------- 서버 동작 (모두 RPC → DB 에서 교사 권한 검사) ----------
  const call = useCallback(
    async <T,>(fn: string, args: Record<string, unknown>): Promise<T | null> => {
      const { data: d, error } = await sb.rpc(fn, args);
      if (error) {
        toast(friendlyError(error), 'error');
        return null;
      }
      return d as T;
    },
    [sb, toast],
  );

  const setPhase = async (p: Phase) => {
    if (!room || room.phase === p) return;
    const r = await call<Room>('set_room_phase', { p_room_id: room.id, p_phase: p });
    if (r) {
      setRoom(r);
      toast(p === 'sharing' ? '모든 학생 화면이 감상 게시판으로 바뀌었어요.' : p === 'drawing' ? '그림 그리기 단계로 돌아갔어요.' : '활동을 마무리했어요. 학생은 더 이상 수정할 수 없어요.', 'success');
    }
  };
  const askPhase = (p: Phase) => {
    if (!room || room.phase === p) return;
    if (p === 'closed')
      return setConfirm({ title: '활동 마무리', message: '수업을 마무리하면 학생들은 그림과 댓글을 더 이상 바꿀 수 없어요. (필요하면 다시 다른 단계로 열 수 있어요)', text: '마무리하기', run: () => setPhase(p) });
    if (p === 'sharing' && submitted === 0)
      return setConfirm({ title: '느낌 나누기 시작', message: '아직 제출된 작품이 없어요. 그래도 시작할까요?', text: '시작하기', run: () => setPhase(p) });
    void setPhase(p);
  };

  const updateSettings = async (patch: { p_comments_enabled?: boolean; p_allow_resubmit?: boolean; p_title?: string; p_max_students?: number }) => {
    if (!room) return;
    const r = await call<Room>('update_room_settings', { p_room_id: room.id, ...patch });
    if (r) setRoom(r);
  };

  const upsertArt = (a: Artwork) => setArtworks((l) => l.map((x) => (x.id === a.id ? a : x)));
  const toggleVisible = async (a: Artwork) => {
    upsertArt({ ...a, is_visible: !a.is_visible }); // 즉시 반영
    const r = await call<Artwork>('set_artwork_visibility', { p_artwork_id: a.id, p_visible: !a.is_visible });
    upsertArt(r ?? a);
  };
  const setAllVisible = async (v: boolean) => {
    if (!room) return;
    const before = artworks;
    setArtworks((l) => l.map((x) => ({ ...x, is_visible: v })));
    const r = await call<number>('set_all_artworks_visibility', { p_room_id: room.id, p_visible: v });
    if (r === null) setArtworks(before);
    else toast(v ? '모든 작품을 공개했어요.' : '모든 작품을 숨겼어요.', 'success');
  };

  const hideComment = async (c: Comment) => {
    const r = await call<Comment>('set_comment_hidden', { p_comment_id: c.id, p_hidden: !c.is_hidden });
    if (r) setComments((l) => l.map((x) => (x.id === r.id ? r : x)));
  };
  const deleteComment = (c: Comment) =>
    setConfirm({
      title: '댓글 삭제', message: `“${c.body}” 댓글을 삭제할까요? 되돌릴 수 없어요.`, text: '삭제', danger: true,
      run: async () => {
        const { error } = await sb.rpc('delete_comment', { p_comment_id: c.id });
        if (error) toast(friendlyError(error), 'error');
        else setComments((l) => l.filter((x) => x.id !== c.id));
      },
    });

  const release = async (p: Participant) => {
    const r = await call<Participant>('release_participant', { p_participant_id: p.id });
    if (r) {
      data.reload();
      toast(`${p.student_number}번 자리를 비웠어요. 새 기기에서 같은 번호로 들어오면 돼요.`, 'success');
    }
  };

  // ---------- 작품 크게 보기 이동 ----------
  const viewable = slots.filter((s) => s.artwork);
  const openIdx = viewable.findIndex((s) => s.artwork!.id === openArt);
  const openSlot = openArt ? (viewable[openIdx] ?? (artworkById.get(openArt) ? { number: 0, artwork: artworkById.get(openArt), participant: participantById.get(artworkById.get(openArt)!.participant_id) } : undefined)) : undefined;
  const go = (d: number) => {
    if (!viewable.length) return;
    const i = openIdx === -1 ? 0 : (openIdx + d + viewable.length) % viewable.length;
    setOpenArt(viewable[i].artwork!.id);
  };

  if (loadError && !loaded)
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">수업방을 불러오지 못했어요.</p>
        <p className="text-ink-500">{friendlyError(loadError)}</p>
        <button onClick={reload} className="h-12 rounded-xl bg-brand-500 px-5 font-bold text-white">다시 시도</button>
      </main>
    );
  if (!loaded)
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
      </main>
    );
  if (!room)
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <p className="text-lg font-semibold">수업방이 없거나 접근 권한이 없어요.</p>
        <Link href="/teacher" className="font-bold text-brand-600">← 내 수업방</Link>
      </main>
    );

  const tbBtn = (active = false) =>
    `inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-bold transition ${active ? 'bg-ink-800 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'}`;

  return (
    <div ref={rootRef} className="flex h-dvh flex-col overflow-hidden bg-paper">
      <ConnectionBanner status={status} onRetry={reload} />

      {/* ===== 상단: 수업 진행 제어 ===== */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-100 bg-white px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/teacher" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-500 hover:bg-ink-100" title="내 수업방"><Icon name="home" /></Link>
          <div className="min-w-0">
            <div className="truncate text-lg font-extrabold leading-tight text-ink-800">{room.title}</div>
            <button onClick={() => setQr(true)} className="font-mono text-sm font-bold tracking-widest text-brand-600 hover:underline">코드 {room.code}</button>
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-2xl bg-ink-100 p-1" aria-label="수업 단계">
          {PHASES.map((p, i) => (
            <button
              key={p.key}
              onClick={() => askPhase(p.key)}
              className={`inline-flex h-12 items-center gap-2 rounded-xl px-4 text-[15px] font-extrabold transition ${room.phase === p.key ? `shadow-md ${p.on}` : 'text-ink-500 hover:bg-white/70'}`}
              aria-pressed={room.phase === p.key}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${room.phase === p.key ? 'bg-white/25' : 'bg-white'}`}>{i + 1}</span>
              <Icon name={p.icon} size={18} />
              {p.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 text-sm font-bold">
          <span className="rounded-xl bg-mint-50 px-3 py-2 text-mint-700">접속 {onlineCount}명</span>
          <span className="rounded-xl bg-butter-50 px-3 py-2 text-ink-700">제출 <span className="text-lg">{submitted}</span>/{room.max_students}</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <StatusDot status={status} />
          <button onClick={() => setQr(true)} className={tbBtn()}><Icon name="qr" size={18} /> QR</button>
          <button onClick={() => setManage(true)} className={tbBtn()}><Icon name="settings" size={18} /> 관리</button>
          <button onClick={() => setResults(true)} className={tbBtn()}><Icon name="download" size={18} /> 결과 저장</button>
          <button onClick={() => toggleFullscreen(rootRef.current)} className={tbBtn(fs)} title="전자칠판 전체 화면"><Icon name={fs ? 'shrink' : 'expand'} size={18} /></button>
        </div>
      </header>

      {/* ===== 본문 ===== */}
      <div className="flex min-h-0 flex-1">
        {layout !== 'feed' && (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2">
              <div className="flex rounded-xl bg-white p-0.5 ring-1 ring-ink-200">
                <button onClick={() => setShowAll(true)} className={`h-9 rounded-lg px-3 text-sm font-bold ${showAll ? 'bg-ink-800 text-white' : 'text-ink-500'}`}>모든 학생 보기</button>
                <button onClick={() => setShowAll(false)} className={`h-9 rounded-lg px-3 text-sm font-bold ${!showAll ? 'bg-ink-800 text-white' : 'text-ink-500'}`}>제출 작품만 보기</button>
              </div>
              <button onClick={() => setAllVisible(true)} className={tbBtn()}><Icon name="eye" size={17} /> 전체 공개</button>
              <button onClick={() => setConfirm({ title: '전체 숨김', message: '모든 작품을 학생들에게 숨길까요? (선생님 화면에서는 흐리게 계속 보여요. 선생님 화면에서도 안 보이게 하려면 \'내 화면도 가리기\' 버튼을 누르세요)', text: '전체 숨김', run: () => setAllVisible(false) })} className={tbBtn()}><Icon name="eyeOff" size={17} /> 전체 숨김</button>
              <button
                onClick={() => setCovered(!covered)}
                className={tbBtn(covered)}
                aria-pressed={covered}
                title="선생님 화면(전자칠판)에서 그림을 모두 가려요. 학생 화면에는 영향이 없어요."
              >
                <Icon name={covered ? 'eye' : 'lock'} size={17} /> {covered ? '내 화면에 다시 보이기' : '내 화면도 가리기'}
              </button>
              <button onClick={() => setMosaic((m) => !m)} className={tbBtn(mosaic)}><Icon name="grid" size={17} /> 협동화 보기</button>
              <span className="mx-1 h-6 w-px bg-ink-200" />
              <Switch checked={room.allow_resubmit_in_sharing} onChange={(v) => updateSettings({ p_allow_resubmit: v })} label="감상 중 그림 수정 허용" disabled={room.phase === 'closed'} />
              <div className="ml-auto flex gap-1">
                <button onClick={() => setLayout(layout === 'gallery' ? 'split' : 'gallery')} className={tbBtn(layout === 'gallery')} title="댓글창 접기/펴기">
                  <Icon name="image" size={17} /> {layout === 'gallery' ? '댓글창 열기' : '갤러리 크게'}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 px-4 pb-4">
              <TeacherGallery
                slots={slots}
                thumbUrl={thumbUrl}
                onlineIds={onlineIds}
                commentCount={commentCount}
                mosaic={mosaic}
                covered={covered}
                onOpen={setOpenArt}
                onToggleVisible={toggleVisible}
              />
            </div>
          </section>
        )}

        {layout !== 'gallery' && (
          <aside className={`min-h-0 border-l border-ink-100 ${layout === 'feed' ? 'flex-1' : 'w-[28%] min-w-[300px] max-w-[460px]'}`}>
            <CommentFeed
              room={room}
              comments={comments}
              participantById={participantById}
              artworkById={artworkById}
              loaded={loaded}
              big={layout === 'feed'}
              onToggleBig={() => setLayout(layout === 'feed' ? 'split' : 'feed')}
              onToggleComments={(v) => updateSettings({ p_comments_enabled: v })}
              onOpenArtwork={setOpenArt}
              onHide={hideComment}
              onDelete={deleteComment}
            />
          </aside>
        )}
      </div>

      <QrModal room={room} open={qr} onClose={() => setQr(false)} />
      <ManageModal
        open={manage}
        onClose={() => setManage(false)}
        room={room}
        participants={participants}
        artworkByParticipant={artworkByParticipant}
        onlineIds={onlineIds}
        onSaveSettings={async (t, m) => {
          await updateSettings({ p_title: t, p_max_students: m });
          toast('저장했어요.', 'success');
        }}
        onToggleResubmit={(v) => updateSettings({ p_allow_resubmit: v })}
        onToggleComments={(v) => updateSettings({ p_comments_enabled: v })}
        onRelease={release}
      />
      <ResultsModal open={results} onClose={() => setResults(false)} sb={sb} room={room} artworks={artworks} comments={comments} participantById={participantById} artworkById={artworkById} />
      {openSlot?.artwork && (
        <ArtworkModal
          sb={sb}
          artwork={openSlot.artwork}
          author={openSlot.participant}
          comments={comments}
          participantById={participantById}
          covered={covered}
          onUncover={() => setCovered(false)}
          onClose={() => setOpenArt(null)}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onToggleVisible={toggleVisible}
          onHideComment={hideComment}
          onDeleteComment={deleteComment}
        />
      )}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message}
        confirmText={confirm?.text}
        danger={confirm?.danger}
        onConfirm={() => confirm?.run()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
