'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * A tiny in-memory cache for personal data loaded in the browser (friends,
 * channels, chats, notifications). Shows what we already have instantly and
 * refreshes it in the background when it's older than `ttl`
 * (stale-while-revalidate). Lives only in this tab's memory and is cleared on
 * sign-out, so nothing personal is written to disk.
 */
type Entry = { at: number; value: unknown };
const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<unknown>>();

function emit(key: string) { listeners.get(key)?.forEach((l) => l()); }

/** Fetch now (sharing one request between callers) and store the result. */
export function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fetcher().then((value) => {
    cache.set(key, { at: Date.now(), value });
    emit(key);
    return value;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Change a cached value right away (optimistic updates); the next refresh corrects it. */
export function mutateCached<T>(key: string, update: (current: T | undefined) => T) {
  cache.set(key, { at: cache.get(key)?.at ?? 0, value: update(cache.get(key)?.value as T | undefined) });
  emit(key);
}

export function clearCache() {
  const keys = [...cache.keys()];
  cache.clear();
  keys.forEach(emit);
}

/** Read a cached value; null `key` means "don't load". Returns undefined until the first load finishes. */
export function useCached<T>(key: string | null, fetcher: () => Promise<T>, ttl = 30_000): T | undefined {
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; });

  const value = useSyncExternalStore(
    (onChange) => {
      if (!key) return () => {};
      const set = listeners.get(key) ?? new Set();
      set.add(onChange);
      listeners.set(key, set);
      return () => { set.delete(onChange); };
    },
    () => (key ? (cache.get(key)?.value as T | undefined) : undefined),
    () => undefined,
  );

  useEffect(() => {
    if (!key) return;
    const entry = cache.get(key);
    if (!entry || Date.now() - entry.at > ttl) revalidate(key, () => fetcherRef.current());
  }, [key, ttl]);

  return value;
}
