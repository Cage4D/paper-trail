/**
 * Judge mode (spec §8) through the API: local test DB + FakeChain (real ML-DSA-87 verification,
 * real encoded logs). The demo keys are the real DEMO_MNEMONICS (never printed). Group recipients
 * are resolved by a stand-in for resolveGroupRecipients with the same checks (board-signed
 * membersHash + each card against that member's keys), since there is no real chain here.
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getAddress } from 'viem';
import { checkRecipientCard, examIdFor, membersHash, roleKeyFromMnemonic, type RoleKey } from '@paper-trail/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.factory.js';
import { ChainService } from './chain/chain.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { DemoService, DEMO_ROLES } from './demo/demo.service.js';
import { FakeChain } from './testing/fake-chain.js';

const CONTRACT = getAddress(process.env.PAPERTRAIL_ADDRESS!);

describe.runIf(!!process.env.DATABASE_URL && !!process.env.DEMO_MNEMONICS)('judge mode', () => {
  let app: INestApplication;
  let db: PrismaService;
  const chain = new FakeChain(CONTRACT);
  const m = JSON.parse(process.env.DEMO_MNEMONICS!) as Record<string, string>;
  const keys: RoleKey[] = DEMO_ROLES.map((r) => roleKeyFromMnemonic(m[r]));
  keys.forEach((k) => chain.register(k));
  chain.examIdFn = examIdFor;
  const http = () => request(app.getHttpServer());
  let demoId: string;
  let start: Record<string, any>;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ChainService).useValue(chain).compile();
    app = mod.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    for (const t of ['relayJob', 'chainEvent', 'mark', 'script', 'scriptTicket', 'rateLimit', 'member', 'epochEnvelope', 'boardState', 'bindChallenge', 'identityMap', 'demo', 'shareBlob', 'centre', 'exam', 'authChallenge', 'user', 'indexerCursor'] as const)
      await (db[t] as { deleteMany: () => Promise<unknown> }).deleteMany();
    app.get(DemoService).resolveRecipients = async (a) => {
      expect(membersHash(a.members.map((x) => x.address))).toBe((await db.epochEnvelope.findFirst({ where: { groupChainId: a.groupChainId.toLowerCase(), epoch: a.epoch, confirmed: true } }))!.membersHash);
      return a.members.map((x) => {
        const k = keys.find((y) => y.evm.toLowerCase() === x.address)!;
        return checkRecipientCard(x.card, { pqPublicKey: k.pq.publicKey, mlkemPublicKey: k.seal.mlkemPublicKey, address: k.address });
      });
    };
  });
  afterAll(async () => app?.close());

  it('beat 1: /demo/start answers at once with both canary variants, then sets the exam, centres and groups in the background', async () => {
    start = (await http().post('/demo/start').expect(201)).body;
    demoId = start.demoId;
    expect(start.label).toMatch(/DEMO — testnet only/);
    expect(start.settingUp).toBe(true);
    expect(start.txs).toEqual([]); // the six txs arrive as "set:*" steps on GET /demo/:id
    expect(start.variants.A).not.toBe(start.variants.B);
    expect(start.variants.minPairDistanceBits).toBeGreaterThanOrEqual(20);
    expect(start.variants.differences.questions).toHaveLength(12);
    expect(Object.keys(start.roleLinks)).toEqual([...DEMO_ROLES]);
    // the start time covers the setup too: about 90 s + the 30 s setup budget from now
    expect(start.startsInSeconds).toBeGreaterThan(100);
    await app.get(DemoService).whenSetUp(demoId);
    const v = (await http().get(`/demo/${demoId}`).expect(200)).body;
    expect(v.steps.map((s: { name: string }) => s.name)).toEqual(['set:createExam', 'set:centreA', 'set:centreB', 'set:groupA', 'set:groupB', 'set:markers', 'set']);
    expect(v.steps.at(-1)).toMatchObject({ beat: 1, ok: true });
    expect(v.steps.at(-1).txs).toHaveLength(6); // createExam, setCentre ×2, rotateEpoch ×3
    expect(v.exam.centres.every((c: { confirmed: boolean; epoch: number }) => c.confirmed && c.epoch === 1)).toBe(true);
  });

  it('acts are refused while a demo is still being set up', async () => {
    const d = await db.demo.create({ data: { examId: '0x' + 'f'.repeat(64), ip: 'x', centres: { A: '0x' + '1'.repeat(64), B: '0x' + '2'.repeat(64) }, startTime: new Date(), steps: [] } });
    const r = await http().post(`/demo/${d.id}/act`).send({ as: 'examiner1', action: 'release' });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/still being set up/);
    expect((await http().get(`/demo/${d.id}`).expect(200)).body.exam).toBeNull();
    await db.demo.delete({ where: { id: d.id } });
  });

  it('beat 2: an early release is refused by the contract (TOO_EARLY), nothing is sent', async () => {
    chain.nextRevert = { errorName: 'TooEarly', args: [BigInt(Math.floor(Date.parse(start.startTime) / 1000))] };
    const r = (await http().post(`/demo/${demoId}/act`).send({ as: 'examiner1', action: 'release' }).expect(200)).body;
    expect(r).toMatchObject({ beat: 2, ok: false, refusedByContract: true, error: { code: 'TOO_EARLY' } });
  });

  it('beats 3–4: examiner-1 bot + judge as examiner 2 → Released; A1 opens: Authentic ✓', async () => {
    await db.demo.update({ where: { id: demoId }, data: { startTime: new Date(Date.now() - 1000) } }); // fake chain has no clock
    expect((await http().post(`/demo/${demoId}/act`).send({ as: 'examiner1', action: 'release' }).expect(200)).body).toMatchObject({ ok: true, count: 1, released: false });
    expect((await http().post(`/demo/${demoId}/act`).send({ as: 'examiner2', action: 'release' }).expect(200)).body).toMatchObject({ ok: true, count: 2, released: true });
    const open = (await http().post(`/demo/${demoId}/act`).send({ as: 'invigilatorA1', action: 'open' }).expect(200)).body;
    expect(open).toMatchObject({ opened: true, authentic: true });
    expect(open.paper).toBe(start.variants.A);
  });

  it('beat 5: remove A2 → epoch 2 → 6 bots submit scripts → A2 cannot open later documents', async () => {
    expect((await http().post(`/demo/${demoId}/act`).send({ as: 'board', action: 'remove-invigilator', params: { target: 'invigilatorA2' } }).expect(200)).body).toMatchObject({ ok: true, epoch: 2 });
    const sub = (await http().post(`/demo/${demoId}/act`).send({ as: 'candidates', action: 'submit-scripts' }).expect(200)).body;
    expect(sub.submitted).toHaveLength(6);
    const a2 = (await http().post(`/demo/${demoId}/act`).send({ as: 'invigilatorA2', action: 'open' }).expect(200)).body;
    expect(a2.laterDocuments).toEqual([
      { what: 'centre A group key, epoch 2', result: 'NOT_A_MEMBER' },
      { what: 'a candidate script', result: 'NOT_A_RECIPIENT' },
    ]);
  });

  it('beat 6: a noisy centre-B excerpt is traced to Centre B, with epoch, recipients and tx links', async () => {
    const l = (await http().post(`/demo/${demoId}/leak`).send({ centre: 'B' }).expect(200)).body;
    expect(l.result.copy).toBe('Centre B');
    expect(l.centre).toMatchObject({ name: 'Centre B', epoch: 1 });
    expect(l.centre.recipients).toHaveLength(1);
    expect(l.centre.setExplorer).toMatch(/^https:\/\/explore\.qore\.network\/tx\/0x/);
  });

  it('beat 7: the demo log and the audit timeline hold every beat', async () => {
    const v = (await http().get(`/demo/${demoId}`).expect(200)).body;
    expect(v.steps.map((s: { beat: number }) => s.beat)).toEqual([1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 4, 5, 5, 5, 6]);
    const audit = (await http().get(v.audit).expect(200)).body;
    const names = new Set(audit.timeline.map((e: { name: string }) => e.name));
    for (const n of ['ExamCreated', 'CentreSet', 'EpochChanged', 'ShareReleased', 'Released', 'ScriptSubmitted']) expect(names.has(n)).toBe(true);
  });

  it('/demo/start is rate-limited to 5 per hour per IP; unknown acts are refused', async () => {
    expect((await http().post(`/demo/${demoId}/act`).send({ as: 'nobody', action: 'release' })).status).toBe(400);
    // beat 1 already counted one start for this client's IP: use that exact key and fill the window
    const row = await db.rateLimit.findFirst({ where: { key: { startsWith: 'demo:' } } });
    expect(row).toBeTruthy();
    await db.rateLimit.update({ where: { key: row!.key }, data: { count: 5, windowStart: new Date() } });
    expect((await http().post('/demo/start')).body.error.code).toBe('RATE_LIMITED');
  });
});
