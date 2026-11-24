// Page side of workers/crypto.worker.ts: one lazily started worker, request/response by id.
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

export class WorkerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function get(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/crypto.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; body: { code?: string; message?: string } }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.body);
    else p.reject(new WorkerError(e.data.body?.code ?? 'ERROR', e.data.body?.message ?? 'Something went wrong.'));
  };
  return worker;
}

export function ask<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    get().postMessage({ ...msg, id });
  });
}

/** Wipe the keys and stop the worker (leaving the page). */
export function stopWorker() {
  if (!worker) return;
  void ask({ type: 'forget' }).finally(() => {
    worker?.terminate();
    worker = null;
  });
}
