/**
 * Regression tests for the Phase 0–5 bug hunt (findings 2, 5–8, 10 and the identity-map gap).
 * Local test database + FakeChain (real ML-DSA-87 verification, real encoded logs, fault knobs).
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { getAddress, type Hex } from 'viem';
import {
  Action, BoardGroups, b64url, buildAction, buildMarksTree, centreGroupKey, createRoleKey, examIdFor, groupChainId, markersGroupKey,
  newPseudonym, recipientCardFor, sealScript, setExam, signAction, signSignIn, toHex, type RoleKey,
} from '@paper-trail/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.factory.js';
import { ChainService } from './chain/chain.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { FakeChain } from './testing/fake-chain.js';
import { config } from './config.js';

const CONTRACT = getAddress(process.env.PAPERTRAIL_ADDRESS!);
const PAPER = readFileSync(new URL('../../../packages/core/fixtures/sample-paper.md', import.meta.url), 'utf8');
const k = { board: createRoleKey(), ex: [createRoleKey(), createRoleKey(), createRoleKey()], inv: [createRoleKey(), createRoleKey()], m: [createRoleKey(), createRoleKey()] };
const all: RoleKey[] = [k.board, ...k.ex, ...k.inv, ...k.m];

describe.runIf(!!process.env.DATABASE_URL)('bug-hunt regressions', () => {
  let app: INestApplication;
  let db: PrismaService;
  const chain = new FakeChain(CONTRACT);
  all.forEach((x) => chain.register(x));
  chain.examIdFn = examIdFor;
  const http = () => request(app.getHttpServer());
  const tokens = new Map<RoleKey, string>();
  const auth = (r: RoleKey) => ({ authorization: `Bearer ${tokens.get(r)}` });
  const admin = { authorization: `Bearer ${config().ADMIN_TOKEN}` };
  const sign = async (who: RoleKey, action: Action, fields: never) =>
    toHex(signAction(who.pq.secretKey, buildAction(action, fields, { chainId: 9800, contract: CONTRACT, signer: who.evm, nonce: await chain.nonceOf(who.evm) }).digest));
  const salt = toHex(new Uint8Array(32).fill(0x77));
  const examId = examIdFor(k.board.evm, salt).toLowerCase() as Hex;
  const A = toHex(new Uint8Array(32).fill(0xaa)) as Hex;
  const B = toHex(new Uint8Array(32).fill(0xbb)) as Hex;
  let setup: Awaited<ReturnType<typeof setExam>>;
  const groups = new BoardGroups();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ChainService).useValue(chain).compile();
    app = mod.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    for (const t of ['relayJob', 'chainEvent', 'mark', 'script', 'scriptTicket', 'rateLimit', 'member', 'epochEnvelope', 'boardState', 'bindChallenge', 'identityMap', 'demo', 'shareBlob', 'centre', 'exam', 'authChallenge', 'user', 'indexerCursor'] as const)
      await (db[t] as { deleteMany: () => Promise<unknown> }).deleteMany();
    for (const r of all) {
      const { body } = await http().post('/auth/siwq/challenge').send({ address: r.address }).expect(200);
      tokens.set(r, (await http().post('/auth/siwq/verify').send({ message: body.message, signature: signSignIn(r, body.message) }).expect(200)).body.token);
      await http().post('/me/role').set(auth(r)).send({ sealCard: recipientCardFor(r) }).expect(200);
    }
    const part = (x: RoleKey) => ({ address: x.evm, recipient: x.recipient });
    setup = await setExam({ paperMarkdown: PAPER, examId, examiners: [part(k.ex[0]), part(k.ex[1]), part(k.ex[2])], board: part(k.board), centreIds: [A, B] });
    const examiners = k.ex.map((x) => x.evm) as [Hex, Hex, Hex];
    const startTime = Math.floor(Date.now() / 1000) + 3600;
    const cf = { salt, board: k.board.evm, examiners, startTime: BigInt(startTime), masterCommitment: setup.masterCommitment, committeeBundleHash: setup.committeeBundleHash };
    await http().post('/exams').set(auth(k.board)).send({ title: 'BH', salt, startTime, examiners, masterCommitment: setup.masterCommitment, committeeBlob: b64url(setup.committeeEnvelope), signature: await sign(k.board, Action.CreateExam, cf as never) }).expect(201);
  });
  afterAll(async () => app?.close());

  const centreBody = async (c: (typeof setup.centres)[number]) => ({
    name: 'C', centreId: c.centreId, commitment: c.commitment, cipherBlob: b64url(c.cipher), shares: c.shares.map((s) => b64url(s)),
    signature: await sign(k.board, Action.SetCentre, { examId, centreId: c.centreId, commitment: c.commitment, cipherHash: c.cipherHash } as never),
  });

  it('finding 2: a receipt timeout keeps the rows, never resends, reports pending, and reconciles', async () => {
    const cA = setup.centres.find((c) => c.centreId === A)!;
    chain.receiptTimeouts = 1;
    const body = await centreBody(cA);
    const r = await http().post(`/exams/${examId}/centres`).send(body).set(auth(k.board)).expect(503);
    expect(r.body.error.code).toBe('RELAYER_BUSY');
    const txHash = r.body.error.params.txHash as string;
    expect(chain.broadcasts.get(txHash)).toBe(1); // signed once, broadcast once
    expect(await db.centre.count({ where: { onchainId: A } })).toBe(1); // ciphertext NOT deleted
    expect(await db.shareBlob.count({ where: { centreId: A } })).toBe(3);
    const job = await db.relayJob.findFirst({ where: { ref: `centre:${examId}:${A}` } });
    expect(job).toMatchObject({ status: 'SUBMITTED', txHash });
    // a retry while pending is refused as pending (no second broadcast)
    expect((await http().post(`/exams/${examId}/centres`).send(body).set(auth(k.board))).body.error.code).toBe('RELAYER_BUSY');
    expect(chain.sent.filter((x) => x.functionName === 'setCentre')).toHaveLength(1);
    // the cron finishes it by hash
    await db.relayJob.update({ where: { id: job!.id }, data: { updatedAt: new Date(Date.now() - 60_000) } });
    const rec = (await http().post('/internal/index').set(admin).expect(200)).body;
    expect(rec.reconciled.confirmed).toBe(1);
    expect((await db.centre.findFirst({ where: { onchainId: A } }))!.confirmed).toBe(true);
    // and now it is simply done
    expect((await http().post(`/exams/${examId}/centres`).send(body).set(auth(k.board))).body.error.code).toBe('CONFLICT');
  });

  it('finding 2: a broadcast that errors after acceptance is found by hash: one tx, success', async () => {
    const cB = setup.centres.find((c) => c.centreId === B)!;
    chain.failBroadcastAfterAccept = 1;
    const r = await http().post(`/exams/${examId}/centres`).send(await centreBody(cB)).set(auth(k.board)).expect(201);
    // the SAME signed bytes were re-broadcast after the transport error (idempotent: "already known");
    // one signature, one hash, applied once — never re-signed with a new nonce
    expect(chain.broadcasts.get(r.body.txHash)).toBe(2);
    expect(chain.sent.filter((x) => x.functionName === 'setCentre')).toHaveLength(2); // A and B, once each
  });

  async function rotate(groupKey: string, kind: 'create' | 'remove', members: RoleKey[], role: 'invigilator' | 'marker' = 'invigilator') {
    const r = kind === 'create' ? groups.create(groupKey, Object.fromEntries(members.map((m) => [m.evm, m.recipient]))) : groups.remove(groupKey, members[0].evm);
    const signature = await sign(k.board, Action.RotateEpoch, { centreId: groupChainId(groupKey), board: k.board.evm, epoch: r.epoch, membersHash: r.membersHash, envelopeHash: r.envelopeHash } as never);
    const common = { envelope: b64url(r.envelope!), epoch: Number(r.epoch), membersHash: r.membersHash, signature, sealedBoardState: b64url(groups.exportSealed(k.board.recipient)) };
    return kind === 'create'
      ? http().post(`/groups/${groupKey}/members`).set(auth(k.board)).send({ addresses: members.map((m) => m.evm), role, ...common })
      : http().delete(`/groups/${groupKey}/members/${members[0].evm}`).set(auth(k.board)).send(common);
  }

  it('findings 2/3: a pending rotation never changes who you seal to until the chain event confirms it', async () => {
    expect((await rotate(centreGroupKey(A), 'create', [k.inv[0], k.inv[1]])).status).toBe(201);
    const before = (await http().get(`/exams/${examId}/centres/${A}/invigilators`).expect(200)).body;
    expect(before).toMatchObject({ epoch: 1, members: [{ address: k.inv[0].evm.toLowerCase() }, { address: k.inv[1].evm.toLowerCase() }] });
    expect(before.epochTx).toMatch(/^0x/);
    expect(before.members[0].card.address).toBe(k.inv[0].address);
    // removal relayed but the receipt times out; the fake chain is already at epoch 2, logs not yet indexed (3-block lag)
    chain.receiptTimeouts = 1;
    expect((await rotate(centreGroupKey(A), 'remove', [k.inv[1]])).status).toBe(503);
    expect((await http().get(`/exams/${examId}/centres/${A}/invigilators`)).body.error.code).toBe('RELAYER_BUSY'); // no stale member list served
    await db.relayJob.updateMany({ where: { status: 'SUBMITTED' }, data: { updatedAt: new Date(Date.now() - 60_000) } });
    await http().post('/internal/index').set(admin).expect(200);
    const after = (await http().get(`/exams/${examId}/centres/${A}/invigilators`).expect(200)).body;
    expect(after).toMatchObject({ epoch: 2, members: [{ address: k.inv[0].evm.toLowerCase() }] });
    expect(await db.member.count({ where: { address: k.inv[1].evm.toLowerCase(), active: true } })).toBe(0);
  });

  it('finding 8: a centre reused after its group rotated starts at the chain epoch', async () => {
    const salt2 = toHex(new Uint8Array(32).fill(0x78));
    const exam2 = examIdFor(k.board.evm, salt2).toLowerCase() as Hex;
    const part = (x: RoleKey) => ({ address: x.evm, recipient: x.recipient });
    const s2 = await setExam({ paperMarkdown: PAPER, examId: exam2, examiners: [part(k.ex[0]), part(k.ex[1]), part(k.ex[2])], board: part(k.board), centreIds: [A] });
    const examiners = k.ex.map((x) => x.evm) as [Hex, Hex, Hex];
    const startTime = Math.floor(Date.now() / 1000) + 3600;
    const cf = { salt: salt2, board: k.board.evm, examiners, startTime: BigInt(startTime), masterCommitment: s2.masterCommitment, committeeBundleHash: s2.committeeBundleHash };
    await http().post('/exams').set(auth(k.board)).send({ title: 'BH2', salt: salt2, startTime, examiners, masterCommitment: s2.masterCommitment, committeeBlob: b64url(s2.committeeEnvelope), signature: await sign(k.board, Action.CreateExam, cf as never) }).expect(201);
    const c = s2.centres[0];
    await http().post(`/exams/${exam2}/centres`).set(auth(k.board)).send({ name: 'A again', centreId: c.centreId, commitment: c.commitment, cipherBlob: b64url(c.cipher), shares: c.shares.map((s) => b64url(s)), signature: await sign(k.board, Action.SetCentre, { examId: exam2, centreId: c.centreId, commitment: c.commitment, cipherHash: c.cipherHash } as never) }).expect(201);
    expect((await http().get(`/exams/${exam2}`).expect(200)).body.centres[0].epoch).toBe(2);
  });

  it('findings 6/7: marking freezes while publishing; the latest revision counts; proofs use the snapshot', async () => {
    // release centre A (epoch 2: inv0) by two examiners so scripts are accepted
    for (const i of [0, 1]) {
      const share = (await http().get(`/exams/${examId}/centres/${A}/my-share`).set(auth(k.ex[i])).expect(200)).body;
      const { prepareRelease, fromB64url } = await import('@paper-trail/core');
      const rel = prepareRelease({ shareEnvelope: fromB64url(share.sealedToExaminer), examinerKeys: k.ex[i].seal, examinerIndex: share.examinerIndex, examId, centreId: A, epoch: 2, invigilators: [k.inv[0].recipient] });
      await http().post(`/exams/${examId}/centres/${A}/release`).set(auth(k.ex[i])).send({ releasedBlob: b64url(rel.blob), blobHash: rel.blobHash, epoch: 2, signature: await sign(k.ex[i], Action.Release, { examId, centreId: A, blobHash: rel.blobHash, examiner: k.ex[i].evm, epoch: 2n } as never) }).expect(201);
    }
    expect((await rotate(markersGroupKey(examId), 'create', k.m, 'marker')).status).toBe(201);
    const ticket = (await http().post(`/exams/${examId}/tickets`).set(auth(k.board)).send({ centreId: A, count: 1 }).expect(201)).body.tickets[0];
    const ps = newPseudonym();
    const s = sealScript({ examId, centreId: A, pseudonym: ps, answers: {}, markers: k.m.map((m) => m.recipient) });
    await http().post(`/exams/${examId}/scripts`).send({ centreId: A, pseudonymHash: s.pseudonymHash, blob: b64url(s.envelope), scriptHash: s.scriptHash, markerEpoch: 1, ticket }).expect(201);
    const [p] = (await http().get(`/exams/${examId}/scripts/pending`).set(auth(k.board)).expect(200)).body;
    await http().post(`/exams/${examId}/scripts/submit`).set(auth(k.board)).send({ items: [{ scriptId: p.scriptId, signature: await sign(k.board, Action.SubmitScript, { examId, centreId: A, pseudonymHash: p.pseudonymHash, scriptHash: p.scriptHash, markerEpoch: 1n } as never) }] }).expect(201);
    // M1 marks 40, M2 marks 70, then M1 revises to 55: 55 must count (finding 7)
    await http().post(`/scripts/${p.scriptId}/marks`).set(auth(k.m[0])).send({ score: 40 }).expect(201);
    await new Promise((r) => setTimeout(r, 20));
    await http().post(`/scripts/${p.scriptId}/marks`).set(auth(k.m[1])).send({ score: 70 }).expect(201);
    await new Promise((r) => setTimeout(r, 20));
    await http().post(`/scripts/${p.scriptId}/marks`).set(auth(k.m[0])).send({ score: 55 }).expect(201);
    const { entries } = (await http().get(`/exams/${examId}/marks`).set(auth(k.board)).expect(200)).body;
    expect(entries).toEqual([{ pseudonymHash: s.pseudonymHash, score: 55 }]);
    // publishing with a pending receipt: marking is frozen (finding 6)
    const root = buildMarksTree(entries).root;
    chain.receiptTimeouts = 1;
    expect((await http().post(`/exams/${examId}/marks/publish`).set(auth(k.board)).send({ merkleRoot: root, signature: await sign(k.board, Action.PublishMarks, { examId, merkleRoot: root } as never) })).status).toBe(503);
    expect((await http().post(`/scripts/${p.scriptId}/marks`).set(auth(k.m[1])).send({ score: 99 })).body.error.code).toBe('CONFLICT');
    // the relay lands; reconciliation + MarksPublished settle it; proofs come from the snapshot
    await db.relayJob.updateMany({ where: { status: 'SUBMITTED' }, data: { updatedAt: new Date(Date.now() - 60_000) } });
    await http().post('/internal/index').set(admin).expect(200);
    const proof = (await http().get(`/exams/${examId}/marks/proof`).query({ pseudonym: ps }).expect(200)).body;
    expect(proof).toMatchObject({ score: 55, merkleRoot: root });
  });

  it('identity map: board only (spec §7.2 gap)', async () => {
    await http().put(`/exams/${examId}/identity-map`).set(auth(k.board)).send({ blob: b64url(new Uint8Array([1, 2, 3])) }).expect(200);
    expect((await http().get(`/exams/${examId}/identity-map`).set(auth(k.board)).expect(200)).body.blob).toBe(b64url(new Uint8Array([1, 2, 3])));
    expect((await http().get(`/exams/${examId}/identity-map`).set(auth(k.m[0]))).body.error.code).toBe('FORBIDDEN');
  });

  it('finding 10: bad query parameters are VALIDATION_FAILED, not "chain unavailable"', async () => {
    expect((await http().get(`/exams/${examId}/events`).query({ after: 'abc' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await http().get('/directory').query({ role: 'foo' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
  });

  it('finding 5: script submissions are rate-limited per IP', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await http().post(`/exams/${examId}/scripts`).send({ centreId: A, pseudonymHash: toHex(new Uint8Array(32).fill(i)), blob: 'AA', scriptHash: toHex(new Uint8Array(32)), markerEpoch: 1, ticket: `pt_${'A'.repeat(22)}` })).status;
    expect(last).toBe(429);
  });
});
