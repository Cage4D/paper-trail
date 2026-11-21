/**
 * Phase 5 flow through the API (local Postgres + FakeChain with real ML-DSA-87 verification
 * and real encoded logs): groups → releases with a revocation in between → Released gating →
 * opening → scripts → blind marking → published root + proofs → audit → QoreX binding.
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { getAddress, type Hex } from 'viem';
import {
  Action, BoardGroups, b64url, bindingStatement, buildAction, buildMarksTree, centreGroupKey, createRoleKey, examIdFor, fromB64url,
  markersGroupKey, newPseudonym, openPaper, openScript, prepareRelease, recipientCardFor, sealScript, setExam, signAction, signSignIn,
  statementHash, toHex, verifyMarkProof, type RoleKey,
} from '@paper-trail/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.factory.js';
import { ChainService } from './chain/chain.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { FakeChain } from './testing/fake-chain.js';

const CONTRACT = getAddress(process.env.PAPERTRAIL_ADDRESS!);
const PAPER = readFileSync(new URL('../../../packages/core/fixtures/sample-paper.md', import.meta.url), 'utf8');
const k = {
  board: createRoleKey(),
  ex: [createRoleKey(), createRoleKey(), createRoleKey()],
  inv: [createRoleKey(), createRoleKey(), createRoleKey()], // A1, A2 (centre A), B1 (centre B)
  markers: [createRoleKey(), createRoleKey()],
  outsider: createRoleKey(),
};
const all: RoleKey[] = [k.board, ...k.ex, ...k.inv, ...k.markers, k.outsider];

describe.runIf(!!process.env.DATABASE_URL)('Phase 5 flow', () => {
  let app: INestApplication;
  let db: PrismaService;
  const chain = new FakeChain(CONTRACT);
  all.forEach((x) => chain.register(x));
  chain.examIdFn = examIdFor;
  const http = () => request(app.getHttpServer());
  const tokens = new Map<RoleKey, string>();
  const auth = (r: RoleKey) => ({ authorization: `Bearer ${tokens.get(r)}` });
  const sign = async (signer: RoleKey, action: Action, fields: never) => {
    const nonce = await chain.nonceOf(signer.evm);
    return toHex(signAction(signer.pq.secretKey, buildAction(action, fields, { chainId: 9800, contract: CONTRACT, signer: signer.evm, nonce }).digest));
  };

  const salt = toHex(new Uint8Array(32).fill(0x55));
  const examId = examIdFor(k.board.evm, salt).toLowerCase() as Hex;
  const A = toHex(new Uint8Array(32).fill(0xa1)) as Hex;
  const B = toHex(new Uint8Array(32).fill(0xb1)) as Hex;
  const groups = new BoardGroups();
  let setup: Awaited<ReturnType<typeof setExam>>;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ChainService).useValue(chain).compile();
    app = mod.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    for (const t of ['relayJob', 'chainEvent', 'mark', 'script', 'member', 'epochEnvelope', 'boardState', 'bindChallenge', 'shareBlob', 'centre', 'exam', 'authChallenge', 'user', 'indexerCursor'] as const)
      await (db[t] as { deleteMany: () => Promise<unknown> }).deleteMany();
    // everyone signs in and publishes a recipient card
    for (const r of all) {
      const { body } = await http().post('/auth/siwq/challenge').send({ address: r.address }).expect(200);
      const v = await http().post('/auth/siwq/verify').send({ message: body.message, signature: signSignIn(r, body.message) }).expect(200);
      tokens.set(r, v.body.token);
      await http().post('/me/role').set(auth(r)).send({ sealCard: recipientCardFor(r) }).expect(200);
    }
    // exam + 2 centres
    const part = (x: RoleKey) => ({ address: x.evm, recipient: x.recipient });
    setup = await setExam({ paperMarkdown: PAPER, examId, examiners: [part(k.ex[0]), part(k.ex[1]), part(k.ex[2])], board: part(k.board), centreIds: [A, B] });
    const examiners = k.ex.map((x) => x.evm) as [Hex, Hex, Hex];
    const startTime = Math.floor(Date.now() / 1000) + 3600;
    const createFields = { salt, board: k.board.evm, examiners, startTime: BigInt(startTime), masterCommitment: setup.masterCommitment, committeeBundleHash: setup.committeeBundleHash };
    await http().post('/exams').set(auth(k.board)).send({ title: 'P5', salt, startTime, examiners, masterCommitment: setup.masterCommitment, committeeBlob: b64url(setup.committeeEnvelope), signature: await sign(k.board, Action.CreateExam, createFields as never) }).expect(201);
    for (const c of setup.centres)
      await http().post(`/exams/${examId}/centres`).set(auth(k.board)).send({ name: c.centreId === A ? 'A' : 'B', centreId: c.centreId, commitment: c.commitment, cipherBlob: b64url(c.cipher), shares: c.shares.map((s) => b64url(s)), signature: await sign(k.board, Action.SetCentre, { examId, centreId: c.centreId, commitment: c.commitment, cipherHash: c.cipherHash } as never) }).expect(201);
  });
  afterAll(async () => app?.close());

  async function rotateAdd(groupKey: string, members: RoleKey[], role: 'invigilator' | 'marker') {
    const r = groups.create(groupKey, Object.fromEntries(members.map((m) => [m.evm, m.recipient])));
    const gid = groupKey.startsWith('centre:') ? groupKey.slice(7) : (await import('@paper-trail/core')).groupChainId(groupKey);
    const signature = await sign(k.board, Action.RotateEpoch, { centreId: gid, board: k.board.evm, epoch: r.epoch, membersHash: r.membersHash, envelopeHash: r.envelopeHash } as never);
    return http().post(`/groups/${groupKey}/members`).set(auth(k.board)).send({ addresses: members.map((m) => m.evm), role, envelope: b64url(r.envelope!), epoch: Number(r.epoch), membersHash: r.membersHash, signature, sealedBoardState: b64url(groups.exportSealed(k.board.recipient)) });
  }

  it('groups: creation is checked (envelope recipients, epoch) and relayed', async () => {
    // an envelope sealed to the wrong members is refused before relaying
    const bogus = new BoardGroups().create(centreGroupKey(A), { [k.inv[0].evm]: k.inv[0].recipient });
    const sig = await sign(k.board, Action.RotateEpoch, { centreId: A, board: k.board.evm, epoch: 1n, membersHash: bogus.membersHash, envelopeHash: bogus.envelopeHash } as never);
    const bad = await http().post(`/groups/${centreGroupKey(A)}/members`).set(auth(k.board)).send({ addresses: [k.inv[0].evm, k.inv[1].evm], envelope: b64url(bogus.envelope!), epoch: 1, membersHash: bogus.membersHash, signature: sig, sealedBoardState: b64url(new Uint8Array(10)) }).expect(400);
    expect(bad.body.error.params.fields).toMatch(/membersHash|envelope/);

    expect((await rotateAdd(centreGroupKey(A), [k.inv[0], k.inv[1]], 'invigilator')).status).toBe(201);
    expect((await rotateAdd(centreGroupKey(B), [k.inv[2]], 'invigilator')).status).toBe(201);
    expect((await rotateAdd(markersGroupKey(examId), k.markers, 'marker')).status).toBe(201);
    const ep = await http().get(`/groups/${centreGroupKey(A)}/epochs`).expect(200);
    expect(ep.body.map((e: { epoch: number }) => e.epoch)).toEqual([1]);
    expect((await http().get('/board/state').set(auth(k.board)).expect(200)).body.sealedState).toBeTruthy();
    expect((await http().get('/exams/' + examId).expect(200)).body.centres.find((c: { centreId: string }) => c.centreId === A).epoch).toBe(1);
  });

  it('release: checked recipients; Released gating; revocation between releases; authentic opening', async () => {
    const cA = setup.centres.find((c) => c.centreId === A)!;
    const doRelease = async (i: number) => {
      const share = await http().get(`/exams/${examId}/centres/${A}/my-share`).set(auth(k.ex[i])).expect(200);
      const inv = await http().get(`/exams/${examId}/centres/${A}/invigilators`).expect(200);
      const recipients = inv.body.members.map((m: { mlkemPublicKey: string; x25519PublicKey: string }) => ({ mlkemPublicKey: fromB64url(m.mlkemPublicKey), x25519PublicKey: Uint8Array.from(Buffer.from(m.x25519PublicKey, 'hex')) }));
      const r = prepareRelease({ shareEnvelope: fromB64url(share.body.sealedToExaminer), examinerKeys: k.ex[i].seal, examinerIndex: share.body.examinerIndex, examId, centreId: A, epoch: inv.body.epoch, invigilators: recipients });
      const signature = await sign(k.ex[i], Action.Release, { examId, centreId: A, blobHash: r.blobHash, examiner: k.ex[i].evm, epoch: BigInt(inv.body.epoch) } as never);
      return http().post(`/exams/${examId}/centres/${A}/release`).set(auth(k.ex[i])).send({ releasedBlob: b64url(r.blob), blobHash: r.blobHash, epoch: inv.body.epoch, signature });
    };
    // non-examiners cannot fetch shares
    expect((await http().get(`/exams/${examId}/centres/${A}/my-share`).set(auth(k.outsider))).body.error.code).toBe('NOT_EXAMINER');

    expect((await doRelease(0)).status).toBe(201);
    const early = await http().get(`/exams/${examId}/centres/${A}/released`).expect(409);
    expect(early.body.error).toMatchObject({ code: 'NOT_RELEASED', message: "Waiting for a second examiner to release this centre's paper (1 of 2)." });
    expect((await doRelease(0)).body.error.code).toBe('ALREADY_RELEASED');

    // the board removes invigilator A2 → epoch 2
    const r = groups.remove(centreGroupKey(A), k.inv[1].evm);
    const signature = await sign(k.board, Action.RotateEpoch, { centreId: A, board: k.board.evm, epoch: r.epoch, membersHash: r.membersHash, envelopeHash: r.envelopeHash } as never);
    await http().delete(`/groups/${centreGroupKey(A)}/members/${k.inv[1].evm}`).set(auth(k.board)).send({ envelope: b64url(r.envelope!), epoch: 2, membersHash: r.membersHash, signature, sealedBoardState: b64url(groups.exportSealed(k.board.recipient)) }).expect(200);

    // a release sealed to the OLD members is refused
    const share = await http().get(`/exams/${examId}/centres/${A}/my-share`).set(auth(k.ex[2])).expect(200);
    const stale = prepareRelease({ shareEnvelope: fromB64url(share.body.sealedToExaminer), examinerKeys: k.ex[2].seal, examinerIndex: 2, examId, centreId: A, epoch: 2, invigilators: [k.inv[0].recipient, k.inv[1].recipient] });
    const sigStale = await sign(k.ex[2], Action.Release, { examId, centreId: A, blobHash: stale.blobHash, examiner: k.ex[2].evm, epoch: 2n } as never);
    expect((await http().post(`/exams/${examId}/centres/${A}/release`).set(auth(k.ex[2])).send({ releasedBlob: b64url(stale.blob), blobHash: stale.blobHash, epoch: 2, signature: sigStale })).status).toBe(400);

    const second = await doRelease(2);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ count: 2, released: true });

    const rel = await http().get(`/exams/${examId}/centres/${A}/released`).expect(200);
    const released = rel.body.released.map((x: { blob: string; epoch: number }) => ({ blob: fromB64url(x.blob), epoch: x.epoch }));
    expect(released.map((x: { epoch: number }) => x.epoch)).toEqual([1, 2]);
    const opened = await openPaper({ released, invigilatorKeys: k.inv[0].seal, examId, centreId: A, cipher: fromB64url(rel.body.cipherBlob), commitment: cA.commitment });
    expect(opened.authentic).toBe(true);
    await expect(openPaper({ released, invigilatorKeys: k.inv[1].seal, examId, centreId: A, cipher: fromB64url(rel.body.cipherBlob), commitment: cA.commitment })).rejects.toThrow(/NOT_A_MEMBER/);
  });

  it('scripts → batch submit → blind marking → published root → proofs', async () => {
    const mk = await http().get(`/exams/${examId}/markers`).expect(200);
    const markers = mk.body.members.map((m: { mlkemPublicKey: string; x25519PublicKey: string }) => ({ mlkemPublicKey: fromB64url(m.mlkemPublicKey), x25519PublicKey: Uint8Array.from(Buffer.from(m.x25519PublicKey, 'hex')) }));
    const pseudonyms = [newPseudonym(), newPseudonym(), newPseudonym()];
    // centre B is not released: refused
    const sB = sealScript({ examId, centreId: B, pseudonym: pseudonyms[0], answers: {}, markers });
    expect((await http().post(`/exams/${examId}/scripts`).send({ centreId: B, pseudonymHash: sB.pseudonymHash, blob: b64url(sB.envelope), scriptHash: sB.scriptHash, markerEpoch: mk.body.epoch })).body.error.code).toBe('NOT_RELEASED');
    for (const [i, ps] of pseudonyms.entries()) {
      const s = sealScript({ examId, centreId: A, pseudonym: ps, answers: { q1: i }, markers });
      await http().post(`/exams/${examId}/scripts`).send({ centreId: A, pseudonymHash: s.pseudonymHash, blob: b64url(s.envelope), scriptHash: s.scriptHash, markerEpoch: mk.body.epoch }).expect(201);
    }
    // a script sealed to someone else is refused
    const wrong = sealScript({ examId, centreId: A, pseudonym: newPseudonym(), answers: {}, markers: [k.outsider.recipient] });
    expect((await http().post(`/exams/${examId}/scripts`).send({ centreId: A, pseudonymHash: wrong.pseudonymHash, blob: b64url(wrong.envelope), scriptHash: wrong.scriptHash, markerEpoch: mk.body.epoch })).status).toBe(400);

    const pending = (await http().get(`/exams/${examId}/scripts/pending`).set(auth(k.board)).expect(200)).body;
    expect(pending).toHaveLength(3);
    // the board signs the batch in nonce order (one nonce per action)
    const seq = [];
    let nonce = await chain.nonceOf(k.board.evm);
    for (const p of pending)
      seq.push({ scriptId: p.scriptId, signature: toHex(signAction(k.board.pq.secretKey, buildAction(Action.SubmitScript, { examId, centreId: p.centreId, pseudonymHash: p.pseudonymHash, scriptHash: p.scriptHash, markerEpoch: BigInt(p.markerEpoch) } as never, { chainId: 9800, contract: CONTRACT, signer: k.board.evm, nonce: nonce++ }).digest)) });
    expect((await http().post(`/exams/${examId}/scripts/submit`).set(auth(k.board)).send({ items: seq }).expect(201)).body.submitted).toHaveLength(3);

    // markers: queue, open, mark (blind: they see pseudonyms only); others are refused
    expect((await http().get(`/exams/${examId}/scripts`).set(auth(k.inv[0]))).body.error.code).toBe('NOT_A_MEMBER');
    const queue = (await http().get(`/exams/${examId}/scripts`).set(auth(k.markers[0])).expect(200)).body;
    for (const q of queue) {
      const body = openScript({ envelope: fromB64url(q.blob), keys: k.markers[0].seal, examId, centreId: q.centreId, pseudonymHash: q.pseudonymHash });
      expect(body.pseudonym).toMatch(/^ps_/);
      await http().post(`/scripts/${q.scriptId}/marks`).set(auth(k.markers[0])).send({ score: 50 + (body.answers as { q1: number }).q1 }).expect(201);
    }
    // publish: root recomputed by the API
    const entries = (await http().get(`/exams/${examId}/marks`).set(auth(k.board)).expect(200)).body.entries;
    const tree = buildMarksTree(entries);
    const badRoot = toHex(new Uint8Array(32).fill(1));
    expect((await http().post(`/exams/${examId}/marks/publish`).set(auth(k.board)).send({ merkleRoot: badRoot, signature: await sign(k.board, Action.PublishMarks, { examId, merkleRoot: badRoot } as never) })).status).toBe(400);
    await http().post(`/exams/${examId}/marks/publish`).set(auth(k.board)).send({ merkleRoot: tree.root, signature: await sign(k.board, Action.PublishMarks, { examId, merkleRoot: tree.root } as never) }).expect(201);
    const proof = (await http().get(`/exams/${examId}/marks/proof`).query({ pseudonym: pseudonyms[2] }).expect(200)).body;
    expect(proof.score).toBe(52);
    expect(verifyMarkProof(proof.merkleRoot, { pseudonymHash: proof.pseudonymHash, score: proof.score }, proof.proof)).toBe(true);
  });

  it('audit timeline and polling events', async () => {
    const a = (await http().get(`/exams/${examId}/audit`).expect(200)).body;
    const names = a.timeline.map((e: { name: string }) => e.name);
    for (const n of ['ExamCreated', 'CentreSet', 'EpochChanged', 'ShareReleased', 'Released', 'ScriptSubmitted', 'MarksPublished']) expect(names).toContain(n);
    expect(a.check.centres).toHaveLength(2);
    const first = (await http().get(`/exams/${examId}/events`).expect(200)).body;
    const after = (await http().get(`/exams/${examId}/events`).query({ after: first.events[2].cursor }).expect(200)).body;
    expect(after.events.length).toBe(first.events.length - 3);
  });

  it('QoreX binding: memo self-transfer + role-signed bindIdentity', async () => {
    const qorex = 'qor1qs7h3qkx3vqj5xyp5wu6w8n8n0rjlqmtqh3n0v'; // stands in for the user's QoreX account
    const ch = (await http().post('/me/bind/challenge').set(auth(k.board)).expect(200)).body;
    const txHash = 'AB'.repeat(32);
    chain.nativeTxs.set(txHash, { code: 0, memo: ch.memo, messages: [{ '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: qorex, to_address: qorex }] });
    const st = statementHash(bindingStatement({ roleAddress: k.board.address, qorexAddress: qorex, nonce: ch.nonce, txHash }));
    // a transfer from another address is refused
    chain.nativeTxs.set('CD'.repeat(32), { code: 0, memo: ch.memo, messages: [{ '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: 'qor1other', to_address: qorex }] });
    expect((await http().post('/me/bind').set(auth(k.board)).send({ qorexAddress: qorex, txHash: 'CD'.repeat(32), signature: await sign(k.board, Action.BindIdentity, { role: k.board.evm, statementHash: st } as never) })).status).toBe(400);
    const r = await http().post('/me/bind').set(auth(k.board)).send({ qorexAddress: qorex, txHash, signature: await sign(k.board, Action.BindIdentity, { role: k.board.evm, statementHash: st } as never) }).expect(200);
    expect(r.body.statementHash).toBe(st);
    expect((await db.user.findUnique({ where: { roleAddress: k.board.address } }))?.qorexAddress).toBe(qorex);
    // the challenge is single-use
    expect((await http().post('/me/bind').set(auth(k.board)).send({ qorexAddress: qorex, txHash, signature: await sign(k.board, Action.BindIdentity, { role: k.board.evm, statementHash: st } as never) })).status).toBe(401);
  });
});
