import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import type { Health } from './types';

// ── theme ──

export type Theme = 'paper' | 'ink';
const themeListeners = new Set<() => void>();
const readTheme = (): Theme => (document.documentElement.getAttribute('data-theme') === 'ink' ? 'ink' : 'paper');

export function setTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem('pt-theme', t);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
  themeListeners.forEach((l) => l());
}

// Module-level (stable) subscribe functions: an inline one would resubscribe on every render.
function subscribeTheme(l: () => void) {
  themeListeners.add(l);
  return () => void themeListeners.delete(l);
}
const serverTheme = (): Theme => 'paper';

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  return [theme, () => setTheme(theme === 'ink' ? 'paper' : 'ink')];
}

// ── clocks ──

/** Current time, re-rendered every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Whole seconds since `active` became true (0 while inactive). For "Sending to QoreChain… 6 s". */
export function useElapsed(active: boolean): number {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      setStart(null);
      return;
    }
    const s = Date.now();
    setStart(s);
    setNow(s);
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return start === null ? 0 : Math.floor((now - start) / 1000);
}

// ── polling ──

/**
 * Calls `fn` now and then every `ms` while mounted (and while `enabled`). Overlapping calls are
 * skipped; polling pauses while the tab is hidden and resumes with an immediate call.
 */
export function usePoll(fn: () => Promise<void>, ms: number, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    let stopped = false;
    const tick = async () => {
      if (busy || stopped || document.hidden) return;
      busy = true;
      try {
        await ref.current();
      } finally {
        busy = false;
      }
    };
    void tick();
    const t = setInterval(tick, ms);
    const vis = () => !document.hidden && void tick();
    document.addEventListener('visibilitychange', vis);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [ms, enabled]);
}

// ── /health, shared by every HealthChip on the page ──

type HealthState = { status: 'loading' } | { status: 'ok'; health: Health } | { status: 'down' };
let healthState: HealthState = { status: 'loading' };
const healthListeners = new Set<() => void>();
let healthTimer: ReturnType<typeof setInterval> | null = null;

async function refreshHealth() {
  lastHealthFetch = Date.now();
  try {
    const health = await api<Health>('/health', { timeoutMs: 30_000 });
    healthState = { status: 'ok', health };
  } catch {
    healthState = { status: 'down' };
  }
  healthListeners.forEach((l) => l());
}

let lastHealthFetch = 0;

function subscribeHealth(l: () => void) {
  healthListeners.add(l);
  if (!healthTimer) {
    // re-mounts (route changes) within a minute reuse the last answer instead of refetching
    if (Date.now() - lastHealthFetch > 30_000) void refreshHealth();
    healthTimer = setInterval(refreshHealth, 60_000);
  }
  return () => {
    healthListeners.delete(l);
    if (!healthListeners.size && healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
  };
}
const readHealth = () => healthState;

export function useHealth(): HealthState {
  return useSyncExternalStore(subscribeHealth, readHealth, readHealth);
}

// ── clipboard ──

export function useCopy(resetMs = 1500): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard?.writeText(text).then(
        () => {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), resetMs);
        },
        () => undefined,
      );
    },
    [resetMs],
  );
  return [copied, copy];
}
