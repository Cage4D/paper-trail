/**
 * API tests against the local Postgres, with a fake ChainService. The fake keeps the real
 * crypto: pqcVerify checks genuine ML-DSA-87 signatures offline (QoreSign), keys come from real
 * role keys, and digests from @paper-trail/core. Only the EVM transport is faked.
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ContractFunctionRevertedError, encodeErrorResult, getAddress, type Hex } from 'viem';
import { pqVerify } from '@qorechain/qoresign';
import { Action, b64url, buildAction, createRoleKey, createSignIn, fromHex, signAction, signSignIn, toHex, type RoleKey } from '@paper-trail/core';
import { PAPERTRAIL_ABI } from '@paper-trail/shared';
import { AppModule } from './app.module.js';
import { configureApp } from './app.factory.js';
import { ChainService } from './chain/chain.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { config } from './config.js';

const CONTRACT = getAddress(process.env.PAPERTRAIL_ADDRESS!);
const roles = { board: createRoleKey(), ex: [createRoleKey(), createRoleKey(), createRoleKey()], outsider: createRoleKey(), unregistered: createRoleKey() };
const registered = new Map<string, RoleKey>([roles.board, ...roles.ex, roles.outsider].map((k) => [k.evm.toLowerCase(), k]));

class FakeChain {
  address = CONTRACT;
  abi = PAPERTRAIL_ABI;
  rest = 'http://fake';
  nonces = new Map<string, bigint>();
  needsReopen = false;
  opened = 0;
  sent: { functionName: string; args: unknown[] }[] = [];
  nextRevert?: { errorName: string; args: unknown[] };
  client = {
    getBalance: async () => 10n ** 18n,
    getBlockNumber: async () => 100n,
    getLogs: async () => [],
    simulateContract: async (p: { functionName: string; args: unknown[] }) => {
      if (this.nextRevert) {
        const r = this.nextRevert;
        this.nextRevert = undefined;
        throw new ContractFunctionRevertedError({ abi: PAPERTRAIL_ABI as never, functionName: p.functionName, data: encodeErrorResult({ abi: PAPERTRAIL_ABI, errorName: r.errorName as never, args: r.args as never }) });
      }
      return { request: p, result: undefined };
    },
    waitForTransactionReceipt: async () => ({ status: 'success', blockNumber: 101n, gasUsed: 250_000n }),
  };
  async relayer() {
    return { cosmos: 'qor1fake', evm: '0x0000000000000000000000000000000000000001' };
  }
  async wallet() {
    return {
      account: { address: '0x0000000000000000000000000000000000000001' },
      writeContract: async (req: { functionName: string; args: unknown[] }) => {
        this.sent.push(req);
        const signer = (req.functionName === 'createExam' ? req.args[1] : roles.board.evm) as string;
        this.nonces.set(signer.toLowerCase(), (this.nonces.get(signer.toLowerCase()) ?? 0n) + 1n);
        return `0x${(this.sent.length).toString(16).padStart(64, '0')}`;
      },
    };
  }
  async nonceOf(signer: Hex) {
    return this.nonces.get(signer.toLowerCase()) ?? 0n;
  }
  async pqcKeyStatus(a: Hex) {
    const k = registered.get(a.toLowerCase());
    return k ? { registered: true, algorithmId: 1, pubkey: toHex(k.pq.publicKey) } : { registered: false, algorithmId: 0, pubkey: '0x' as Hex };
  }
  async pqcVerify(pk: Hex, sig: Hex, msg: Hex) {
    return pqVerify(fromHex(pk), fromHex(msg), fromHex(sig));
  }
  async windowNeedsReopen() {
    return this.needsReopen;
  }
  async openWindow() {
    this.opened++;
    this.needsReopen = false;
    return 'WINDOWTX';
  }
  async windowStatus() {
    return { found: true, live: true, remainingTxs: 40n, remainingBlocks: 9000n, allowedTargets: [CONTRACT.toLowerCase()] };
  }
  async relayerBalanceWei() {
    return 10n ** 18n;
  }
}

const hasDb = !!process.env.DATABASE_URL;
describe.runIf(hasDb)('API', () => {
  let app: INestApplication;
  let db: PrismaService;
  const chain = new FakeChain();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ChainService).useValue(chain).compile();
    app = mod.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    for (const t of ['relayJob', 'chainEvent', 'shareBlob', 'centre', 'exam', 'authChallenge', 'user', 'indexerCursor'] as const) await (db[t] as { deleteMany: () => Promise<unknown> }).deleteMany();
  });
  afterAll(async () => app?.close());

  async function login(k: RoleKey): Promise<string> {
    const { body } = await http().post('/auth/siwq/challenge').send({ address: k.address }).expect(200);
    const sig = signSignIn(k, body.message);
    const res = await http().post('/auth/siwq/verify').send({ message: body.message, signature: sig }).expect(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/pt_session=.*HttpOnly/);
    return res.body.token as string;
  }

  describe('auth (SIWQ signed by the role key)', () => {
    it('challenge → sign → verify issues a session; the challenge is single-use', async () => {
      const { body } = await http().post('/auth/siwq/challenge').send({ address: roles.board.address }).expect(200);
      expect(body.message).toContain(`Chain ID: qorechain-diana`);
      const signature = signSignIn(roles.board, body.message);
      await http().post('/auth/siwq/verify').send({ message: body.message, signature }).expect(200);
      const again = await http().post('/auth/siwq/verify').send({ message: body.message, signature }).expect(401);
      expect(again.body.error.code).toBe('UNAUTHENTICATED');
    });
    it('a key that is not registered on chain gets KEY_NOT_REGISTERED', async () => {
      const { body } = await http().post('/auth/siwq/challenge').send({ address: roles.unregistered.address }).expect(200);
      const r = await http().post('/auth/siwq/verify').send({ message: body.message, signature: signSignIn(roles.unregistered, body.message) }).expect(412);
      expect(r.body.error).toEqual({ code: 'KEY_NOT_REGISTERED', message: "Your post-quantum keys aren't registered yet. Finish setup first." });
    });
    it('a signature by another key gets BAD_SIGNATURE; a forged message is refused', async () => {
      const { body } = await http().post('/auth/siwq/challenge').send({ address: roles.board.address }).expect(200);
      // QoreSign refuses to sign for an address the key does not control, so forge: corrupt the ML-DSA part
      const genuine = signSignIn(roles.board, body.message);
      const pq = Buffer.from(genuine.pq!.signature, 'base64');
      pq[100] ^= 1;
      const forgedSig = { ...genuine, pq: { ...genuine.pq!, signature: pq.toString('base64') } };
      expect((await http().post('/auth/siwq/verify').send({ message: body.message, signature: forgedSig })).body.error.code).toBe('BAD_SIGNATURE');
      const forged = createSignIn({ domain: config().APP_DOMAIN, uri: config().APP_URI, address: roles.board.address, nonce: 'deadbeef00112233' });
      expect((await http().post('/auth/siwq/verify').send({ message: forged, signature: signSignIn(roles.board, forged) })).status).toBe(401);
    });
  });

  describe('exams and the relayer', () => {
    const salt = toHex(new Uint8Array(32).fill(9));
    const startTime = Math.floor(Date.now() / 1000) + 3600;
    const examiners = roles.ex.map((k) => k.evm) as [Hex, Hex, Hex];
    const committeeBlob = b64url(new Uint8Array(200).fill(7));
    const master = toHex(new Uint8Array(32).fill(1));
    let token: string;
    let examId: string;

    function signed(signer: RoleKey, nonce: bigint, action: Action, fields: never) {
      const a = buildAction(action, fields, { chainId: 9800, contract: CONTRACT, signer: signer.evm, nonce });
      return toHex(signAction(signer.pq.secretKey, a.digest));
    }
    const committeeHash = async () => (await import('@paper-trail/core')).sha3Hex(new Uint8Array(200).fill(7));

    beforeAll(async () => {
      token = await login(roles.board);
    });

    it('needs a session and validates the body', async () => {
      expect((await http().post('/exams').send({})).status).toBe(401);
      const r = await http().post('/exams').set('authorization', `Bearer ${token}`).send({ title: 'x' }).expect(400);
      expect(r.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('a signature by the wrong key is refused before anything is sent (BAD_SIGNATURE), and the row is rolled back', async () => {
      const fields = { salt, board: roles.board.evm, examiners, startTime: BigInt(startTime), masterCommitment: master, committeeBundleHash: await committeeHash() };
      const bad = signed(roles.outsider, 0n, Action.CreateExam, fields as never);
      const r = await http().post('/exams').set('authorization', `Bearer ${token}`).send({ title: 'T', salt, startTime, examiners, masterCommitment: master, committeeBlob, signature: bad }).expect(401);
      expect(r.body.error.code).toBe('BAD_SIGNATURE');
      expect(chain.sent).toHaveLength(0);
      expect(await db.exam.count()).toBe(0);
    });

    it('createExam: verified, window reopened when low, sent; the exam is stored', async () => {
      chain.needsReopen = true;
      const fields = { salt, board: roles.board.evm, examiners, startTime: BigInt(startTime), masterCommitment: master, committeeBundleHash: await committeeHash() };
      const signature = signed(roles.board, 0n, Action.CreateExam, fields as never);
      const r = await http().post('/exams').set('authorization', `Bearer ${token}`).send({ title: 'Mock', salt, startTime, examiners, masterCommitment: master, committeeBlob, signature }).expect(201);
      expect(chain.opened).toBe(1);
      expect(r.body.windowReopened).toBe('WINDOWTX');
      expect(chain.sent[0].functionName).toBe('createExam');
      examId = r.body.examId;
      const view = await http().get(`/exams/${examId}`).expect(200);
      expect(view.body).toMatchObject({ title: 'Mock', board: roles.board.evm.toLowerCase(), status: 'PENDING' });
      expect((await db.relayJob.findFirst({ where: { status: 'CONFIRMED' } }))?.action).toBe('CreateExam');
    });

    it('setCentre: board only; contract reverts map to catalog codes', async () => {
      const centreId = toHex(new Uint8Array(32).fill(0xc1));
      const commitment = toHex(new Uint8Array(32).fill(2));
      const cipher = new Uint8Array(500).fill(3);
      const { sha3Hex } = await import('@paper-trail/core');
      const fields = { examId, centreId, commitment, cipherHash: sha3Hex(cipher) };
      const body = (sig: Hex) => ({ name: 'Centre A', centreId, commitment, cipherBlob: b64url(cipher), shares: [b64url(new Uint8Array(40).fill(1)), b64url(new Uint8Array(40).fill(2)), b64url(new Uint8Array(40).fill(3))], signature: sig });
      const outsiderToken = await login(roles.outsider);
      expect((await http().post(`/exams/${examId}/centres`).set('authorization', `Bearer ${outsiderToken}`).send(body(signed(roles.outsider, 0n, Action.SetCentre, fields as never)))).body.error.code).toBe('FORBIDDEN');

      chain.nextRevert = { errorName: 'TooEarly', args: [BigInt(startTime)] };
      const sig = signed(roles.board, 1n, Action.SetCentre, fields as never);
      const early = await http().post(`/exams/${examId}/centres`).set('authorization', `Bearer ${token}`).send(body(sig)).expect(409);
      expect(early.body.error.code).toBe('TOO_EARLY');
      expect(early.body.error.message).toMatch(/^This paper is still sealed\. It can be released from \d{4}-/);
      expect(await db.centre.count()).toBe(0); // rolled back

      const ok = await http().post(`/exams/${examId}/centres`).set('authorization', `Bearer ${token}`).send(body(sig)).expect(201);
      expect(ok.body.cipherHash).toBe(fields.cipherHash);
      expect(await db.shareBlob.count({ where: { centreId } })).toBe(3);
      const c = await http().get(`/exams/${examId}/centres/${centreId}/cipher`).expect(200);
      expect(c.body.cipherBlob).toBe(b64url(cipher));
    });

    it('committee blob: committee members only', async () => {
      expect((await http().get(`/exams/${examId}/committee`).set('authorization', `Bearer ${token}`).expect(200)).body.committeeBlob).toBe(committeeBlob);
      const ex2 = await login(roles.ex[1]);
      await http().get(`/exams/${examId}/committee`).set('authorization', `Bearer ${ex2}`).expect(200);
      const out = await login(roles.outsider);
      expect((await http().get(`/exams/${examId}/committee`).set('authorization', `Bearer ${out}`)).body.error.code).toBe('FORBIDDEN');
    });
  });

  it('admin endpoints need the admin token; health reports without secrets', async () => {
    expect((await http().post('/internal/index')).status).toBe(401);
    expect((await http().post('/internal/index').set('authorization', 'Bearer wrong-token-0123456789')).status).toBe(401);
    await http().post('/internal/index').set('authorization', `Bearer ${config().ADMIN_TOKEN}`).expect(200);
    const h = await http().get('/health').expect(200);
    expect(h.body.ok).toBe(true);
    expect(JSON.stringify(h.body)).not.toContain(config().JWT_SECRET);
  });
});
