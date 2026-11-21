/**
 * Postgres advisory locks on a dedicated connection (session-level), NOT inside an interactive
 * transaction: a transaction timeout can never release a lock while work it guards (a broadcast,
 * a receipt wait) is still in flight (bug-hunt finding 2).
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { config } from '../config.js';

export const LOCK = { relay: 7_000_001, indexer: 7_000_002, demo: 7_000_003 } as const;

@Injectable()
export class LockService implements OnModuleDestroy {
  private pool?: pg.Pool;
  private get p(): pg.Pool {
    // session-level advisory locks need a DIRECT connection: through a transaction-mode pooler (Neon's
    // default DATABASE_URL) lock and unlock could land on different server connections
    this.pool ??= new pg.Pool({ connectionString: config().DATABASE_URL_UNPOOLED || config().DATABASE_URL, max: 4, idleTimeoutMillis: 10_000 });
    return this.pool;
  }

  /** Wait for the lock, run fn, always unlock. */
  async withLock<T>(id: number, fn: () => Promise<T>): Promise<T> {
    const c = await this.p.connect();
    try {
      await c.query('SELECT pg_advisory_lock($1)', [id]);
      try {
        return await fn();
      } finally {
        await c.query('SELECT pg_advisory_unlock($1)', [id]).catch(() => undefined);
      }
    } finally {
      c.release();
    }
  }

  /** Run fn only if the lock is free right now; otherwise return null. */
  async tryLock<T>(id: number, fn: () => Promise<T>): Promise<T | null> {
    const c = await this.p.connect();
    try {
      const r = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [id]);
      if (!r.rows[0]?.ok) return null;
      try {
        return await fn();
      } finally {
        await c.query('SELECT pg_advisory_unlock($1)', [id]).catch(() => undefined);
      }
    } finally {
      c.release();
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }
}
