'use client';
import JSZip from 'jszip';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUCKET, type Artwork, type Comment, type Participant, type Room } from './types';
import { pad2, safeFileName } from './format';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function dateTag(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}
export function baseName(room: Room) {
  return `${dateTag(room.created_at)}_${safeFileName(room.title)}`;
}
export function artworkFileName(p: Participant | undefined, a: Artwork) {
  return `${pad2(p?.student_number ?? 0)}번_${safeFileName(p?.nickname ?? '학생')}${a.is_visible ? '' : '_숨김'}.jpg`;
}

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function commentsCsv(comments: Comment[], participantById: Map<string, Participant>, artworkById: Map<string, Artwork>) {
  const rows = [['작품 번호', '작품 별명', '작성자 번호', '작성자 별명', '댓글', '작성 시각', '상태']];
  const sorted = comments.slice().sort((a, b) => {
    const pa = participantById.get(artworkById.get(a.artwork_id)?.participant_id ?? '')?.student_number ?? 0;
    const pb = participantById.get(artworkById.get(b.artwork_id)?.participant_id ?? '')?.student_number ?? 0;
    return pa - pb || (a.created_at < b.created_at ? -1 : 1);
  });
  for (const c of sorted) {
    const art = artworkById.get(c.artwork_id);
    const target = art ? participantById.get(art.participant_id) : undefined;
    const author = participantById.get(c.author_participant_id);
    rows.push([
      String(target?.student_number ?? ''), target?.nickname ?? '', String(author?.student_number ?? ''), author?.nickname ?? '',
      c.body, new Date(c.created_at).toLocaleString('ko-KR'), c.is_hidden ? '숨김' : '공개',
    ]);
  }
  // 엑셀에서 한글이 깨지지 않도록 BOM 추가
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

async function downloadAll(sb: SupabaseClient, paths: string[], onProgress?: (done: number, total: number) => void) {
  const out = new Map<string, Blob>();
  let done = 0;
  const queue = paths.slice();
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift()!;
      for (let t = 0; t < 3; t++) {
        const { data } = await sb.storage.from(BUCKET).download(p);
        if (data) {
          out.set(p, data);
          break;
        }
        await new Promise((r) => setTimeout(r, 500 * (t + 1)));
      }
      onProgress?.(++done, paths.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

function sortedArtworks(artworks: Artwork[], participantById: Map<string, Participant>) {
  return artworks
    .slice()
    .sort((a, b) => (participantById.get(a.participant_id)?.student_number ?? 0) - (participantById.get(b.participant_id)?.student_number ?? 0));
}

export async function buildZip(
  sb: SupabaseClient, room: Room, artworks: Artwork[], participantById: Map<string, Participant>,
  artworkById: Map<string, Artwork>, comments: Comment[], onProgress?: (done: number, total: number) => void,
) {
  const list = sortedArtworks(artworks, participantById);
  const blobs = await downloadAll(sb, list.map((a) => a.image_path), onProgress);
  const zip = new JSZip();
  const folder = zip.folder('그림')!;
  for (const a of list) {
    const b = blobs.get(a.image_path);
    if (b) folder.file(artworkFileName(participantById.get(a.participant_id), a), b);
  }
  zip.file('댓글.csv', commentsCsv(comments, participantById, artworkById));
  zip.file('수업정보.txt', `수업: ${room.title}\n코드: ${room.code}\n만든 날: ${new Date(room.created_at).toLocaleString('ko-KR')}\n작품 수: ${list.length}\n댓글 수: ${comments.length}\n`);
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

/** 모든 작품을 출석번호 순으로 이어 붙여 하나의 협동화 이미지로 */
export async function buildCollage(
  sb: SupabaseClient, room: Room, artworks: Artwork[], participantById: Map<string, Participant>,
  opts: { includeHidden: boolean; labels: boolean }, onProgress?: (done: number, total: number) => void,
) {
  const list = sortedArtworks(artworks.filter((a) => opts.includeHidden || a.is_visible), participantById);
  if (!list.length) throw new Error('합칠 작품이 없어요.');
  const blobs = await downloadAll(sb, list.map((a) => a.image_path), onProgress);
  const n = list.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.4)));
  const rows = Math.ceil(n / cols);
  const tw = 480, th = 360, lab = opts.labels ? 40 : 0, gap = opts.labels ? 14 : 0, pad = 40, head = 110;
  const W = pad * 2 + cols * tw + (cols - 1) * gap;
  const H = pad + head + rows * (th + lab) + (rows - 1) * gap + pad;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2a2f3d';
  ctx.font = 'bold 48px "Pretendard Variable", Pretendard, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(room.title, pad, pad);
  ctx.fillStyle = '#737a8e';
  ctx.font = '26px "Pretendard Variable", Pretendard, sans-serif';
  ctx.fillText(`${new Date(room.created_at).toLocaleDateString('ko-KR')} · 작품 ${n}점`, pad, pad + 62);

  for (let i = 0; i < n; i++) {
    const a = list[i];
    const x = pad + (i % cols) * (tw + gap);
    const y = pad + head + Math.floor(i / cols) * (th + lab + gap);
    const b = blobs.get(a.image_path);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, tw, th);
    if (b) {
      const bmp = await createImageBitmap(b);
      ctx.drawImage(bmp, x, y, tw, th);
      bmp.close?.();
    }
    if (opts.labels) {
      const p = participantById.get(a.participant_id);
      ctx.fillStyle = '#3e4456';
      ctx.font = 'bold 24px "Pretendard Variable", Pretendard, sans-serif';
      ctx.fillText(`${p?.student_number ?? ''}번 ${p?.nickname ?? ''}`, x + 4, y + th + 8);
    }
  }
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('이미지 생성 실패'))), 'image/jpeg', 0.92));
}
