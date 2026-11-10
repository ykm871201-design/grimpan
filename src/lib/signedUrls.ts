'use client';
import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUCKET } from './types';

// 비공개 버킷의 이미지를 보기 위한 서명 URL 캐시.
// 재제출 시 파일 경로 자체가 바뀌므로(버전별 새 파일) 브라우저 캐시에 이전 그림이 남지 않습니다.
const TTL_SEC = 6 * 60 * 60;
const cache = new Map<string, { url: string; exp: number }>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function fresh(path: string) {
  const c = cache.get(path);
  return c && c.exp - Date.now() > 10 * 60 * 1000 ? c.url : null;
}

async function signMany(sb: SupabaseClient, paths: string[]) {
  const missing = paths.filter((p) => !fresh(p) && !inflight.has(p));
  if (!missing.length) return;
  const job = (async () => {
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(chunk, TTL_SEC);
      if (error || !data) continue;
      data.forEach((d) => {
        if (d.signedUrl && d.path) cache.set(d.path, { url: d.signedUrl, exp: Date.now() + TTL_SEC * 1000 });
      });
    }
  })();
  missing.forEach((p) => inflight.set(p, job));
  try {
    await job;
  } finally {
    missing.forEach((p) => inflight.delete(p));
    listeners.forEach((l) => l());
  }
}

export function useSignedUrls(sb: SupabaseClient | null, paths: (string | null | undefined)[]) {
  const [, setTick] = useState(0);
  const key = paths.filter(Boolean).sort().join('|');
  const list = useMemo(() => (key ? key.split('|') : []), [key]);

  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    if (!sb || !list.length) return;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      await signMany(sb, list);
      // 실패(네트워크)한 항목은 잠시 후 다시 시도
      if (list.some((p) => !fresh(p))) retry = setTimeout(run, 3000);
    };
    void run();
    return () => {
      if (retry) clearTimeout(retry);
    };
  }, [sb, list]);

  return (path?: string | null) => (path ? fresh(path) : null);
}
