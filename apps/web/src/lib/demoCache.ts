// Per-demo cache of the action responses that GET /demo/:id doesn't return again (the canary
// variants, the decrypted paper, leak excerpts, role addresses). sessionStorage only: it holds
// demo data, never keys or tokens. A reload in the same tab restores everything; in a fresh tab
// the page falls back to what `steps` says (see demoState.ts).
import type { DemoStart, LeakResult, OpenResult, ReleaseResult, RemoveResult, ScriptsResult } from './types';

export interface DemoCache {
  start?: DemoStart;
  early?: ReleaseResult[]; // beat 2 refusals
  releases?: Partial<Record<'examiner1' | 'examiner2' | 'examiner3', ReleaseResult>>;
  openA1?: OpenResult;
  remove?: RemoveResult;
  scripts?: ScriptsResult;
  openA2?: OpenResult;
  leaks?: LeakResult[];
}

const key = (id: string) => `pt-demo:${id}`;

export function readDemoCache(id: string): DemoCache {
  try {
    return (JSON.parse(sessionStorage.getItem(key(id)) ?? '{}') as DemoCache) ?? {};
  } catch {
    return {};
  }
}

export function writeDemoCache(id: string, patch: Partial<DemoCache>): DemoCache {
  const next = { ...readDemoCache(id), ...patch };
  try {
    sessionStorage.setItem(key(id), JSON.stringify(next));
  } catch {
    /* quota or private mode: the page still works from `steps` */
  }
  return next;
}
