/**
 * The browser relay for QoreChain's native lane forwards only allowlisted reads and Tendermint
 * methods, unchanged, and rate-limits broadcasts. The upstream (QoreChain) is a stubbed fetch.
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module.js';
import { configureApp } from './app.factory.js';
import { PrismaService } from './prisma/prisma.service.js';

const ADDR = 'qor1u39s6c9ujvy9kpuz22p0mzck4q9k7f5y6nv85d';

describe.runIf(!!process.env.DATABASE_URL)('chain relay (/chain/*)', () => {
  let app: INestApplication;
  const upstream: { url: string; body?: string }[] = [];
  const realFetch = globalThis.fetch;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app);
    await app.init();
    await app.get(PrismaService).rateLimit.deleteMany();
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('http://127.0.0.1')) return realFetch(url, init); // supertest's own server
      upstream.push({ url: u, body: init?.body as string | undefined });
      if (u.includes('/cosmos/auth/v1beta1/accounts/')) return new Response(JSON.stringify({ account: { account_number: '7', sequence: '3' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { hash: 'ABC', code: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await app?.close();
  });

  it('forwards an allowlisted REST read unchanged', async () => {
    const r = await http().get(`/chain/rest/cosmos/auth/v1beta1/accounts/${ADDR}`).expect(200);
    expect(r.body.account.sequence).toBe('3');
    expect(upstream.at(-1)!.url).toBe(`https://api-testnet.qore.host/cosmos/auth/v1beta1/accounts/${ADDR}`);
  });

  it('refuses REST paths outside the allowlist (no open proxy)', async () => {
    for (const p of ['/cosmos/bank/v1beta1/supply', `/qorechain/abstractaccount/v1/accounts/${ADDR}`, '/cosmos/auth/v1beta1/accounts/../../evil', '/cosmos/auth/v1beta1/accounts/not-an-address'])
      expect((await http().get(`/chain/rest${p}`)).status).toBe(403);
  });

  it('forwards allowlisted Tendermint methods, including a broadcast of an already-signed tx, byte for byte', async () => {
    const call = { jsonrpc: '2.0', id: 9, method: 'broadcast_tx_sync', params: { tx: 'CpQBCo4B' } };
    const r = await http().post('/chain/rpc').send(call).expect(200);
    expect(r.body.result.hash).toBe('ABC');
    expect(JSON.parse(upstream.at(-1)!.body!)).toEqual(call);
  });

  it('refuses other Tendermint methods', async () => {
    for (const method of ['unsafe_flush_mempool', 'dial_seeds', 'net_info', 'genesis'])
      expect((await http().post('/chain/rpc').send({ jsonrpc: '2.0', id: 1, method })).status).toBe(403);
  });

  it('rate-limits broadcasts per IP (20 per 10 minutes)', async () => {
    const send = () => http().post('/chain/rpc').send({ jsonrpc: '2.0', id: 1, method: 'broadcast_tx_sync', params: { tx: 'AA' } });
    for (let i = 0; i < 19; i++) expect((await send()).status).toBe(200); // one was used above
    expect((await send()).body.error.code).toBe('RATE_LIMITED');
  });
});
