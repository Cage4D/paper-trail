/**
 * Judge mode (spec §8): a fresh exam driven by the DEMO role keys (DEMO_MNEMONICS: testnet only,
 * pre-registered and pre-funded, never real users' keys). The API plays every client role here.
 * It goes through the SAME services as real clients, so every guard still applies: the relayer
 * verifies ML-DSA-87 signatures off-chain before sending; envelopes are checked against the
 * group's members; epochs and Released gating apply; recipients are verified against the chain
 * (resolveGroupRecipients); scripts need tickets. Every on-chain step is a real diana tx.
 *
 * Beats: 1 set (2 canary variants) · 2 early release refused (TOO_EARLY, real simulation) ·
 * 3 examiner-1 bot releases + the judge releases as examiner 2 → Released · 4 invigilator A1
 * opens: Authentic ✓ · 5 board removes A2 → epoch 2 → 6 candidate bots submit scripts → A2
 * cannot open later documents · 6 leak traced to centre B · 7 audit.
 *
 * The shared demo keys sign with on-chain nonces, so every demo step runs under one advisory lock
 * (two judges never race each other's nonces).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Hex } from 'viem';
import {
  Action, BoardGroups, SAMPLE_PAPER, b64url, buildAction, centreGroupKey, examIdFor, fromB64url, groupChainId, markersGroupKey, matchLeak,
  newPseudonym, openCommitteeBundle, openGroupEpoch, openPaper, openScript, prepareRelease, randomBytes, recipientCardFor,
  resolveGroupRecipients, roleKeyFromMnemonic, sealScript, setExam, signAction, simulateLeak, toHex, type RoleKey,
} from '@paper-trail/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { LOCK, LockService } from '../common/lock.service.js';
import { RateLimitService } from '../common/rate-limit.service.js';
import { ApiError } from '../common/api-error.js';
import { ExamsService } from '../exams/exams.service.js';
import { ReleaseService } from '../exams/release.service.js';
import { GroupsService } from '../groups/groups.service.js';
import { MemberKeysService } from '../groups/members.js';
import { ScriptsService } from '../scripts/scripts.service.js';
import { config } from '../config.js';
import type { Session } from '../auth/session.js';

export const DEMO_ROLES = ['board', 'examiner1', 'examiner2', 'examiner3', 'invigilatorA1', 'invigilatorA2', 'invigilatorB1', 'marker1', 'marker2'] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];
const LABEL: Record<DemoRole, string> = {
  board: 'Exam board', examiner1: 'Examiner 1 (bot)', examiner2: 'Examiner 2 (you)', examiner3: 'Examiner 3', invigilatorA1: 'Invigilator A1',
  invigilatorA2: 'Invigilator A2', invigilatorB1: 'Invigilator B1', marker1: 'Marker 1', marker2: 'Marker 2',
};
const CENTRE_OF: Partial<Record<DemoRole, 'A' | 'B'>> = { invigilatorA1: 'A', invigilatorA2: 'A', invigilatorB1: 'B' };
export const DEMO_START_DELAY_S = 90;
const CANDIDATES = 6;

interface Step {
  beat: number;
  name: string;
  at: string;
  ok: boolean;
  summary: string;
  txs: string[];
}

@Injectable()
export class DemoService {
  private readonly log = new Logger('Demo');
  private keysCache?: Record<DemoRole, RoleKey>;
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(LockService) private readonly locks: LockService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(ExamsService) private readonly exams: ExamsService,
    @Inject(ReleaseService) private readonly release: ReleaseService,
    @Inject(GroupsService) private readonly groups: GroupsService,
    @Inject(MemberKeysService) private readonly members: MemberKeysService,
    @Inject(ScriptsService) private readonly scripts: ScriptsService,
  ) {}

  // ── keys, sessions, signing ──

  private keys(): Record<DemoRole, RoleKey> {
    if (this.keysCache) return this.keysCache;
    const raw = config().DEMO_MNEMONICS;
    if (!raw) throw new ApiError('ACTION_REJECTED', { reason: 'judge mode is not configured on this server' });
    const m = JSON.parse(raw) as Record<string, string>;
    this.keysCache = Object.fromEntries(DEMO_ROLES.map((r) => {
      if (!m[r]) throw new ApiError('ACTION_REJECTED', { reason: `judge mode is missing the ${r} key` });
      return [r, roleKeyFromMnemonic(m[r])];
    })) as Record<DemoRole, RoleKey>;
    return this.keysCache;
  }

  /** The demo role as a signed-in user with its recipient card (the server holds the demo keys). */
  private async session(role: DemoRole): Promise<Session> {
    const k = this.keys()[role];
    const evm = k.evm.toLowerCase() as `0x${string}`;
    const u = await this.db.user.upsert({
      where: { roleAddress: k.address },
      create: { roleAddress: k.address, evmAddress: evm, sealCard: recipientCardFor(k) as object },
      update: {},
    });
    if (!u.sealCard) await this.db.user.update({ where: { id: u.id }, data: { sealCard: recipientCardFor(k) as object } });
    return { userId: u.id, roleAddress: k.address, evm };
  }

  private async sign(role: DemoRole, action: Action, fields: never, nonceOverride?: bigint): Promise<Hex> {
    const k = this.keys()[role];
    const nonce = nonceOverride ?? (await this.chain.nonceOf(k.evm));
    return toHex(signAction(k.pq.secretKey, buildAction(action, fields, { chainId: config().CHAIN_ID, contract: this.chain.address, signer: k.evm, nonce }).digest));
  }

  /** Chain verification of a group's recipients (overridable in tests, where there is no real chain). */
  resolveRecipients: typeof resolveGroupRecipients = resolveGroupRecipients;

  /** Recipients of a group, verified against the chain (finding 3), not taken from our own DB. */
  private async verifiedRecipients(board: string, groupKey: string) {
    const g = await this.members.publicState(board, groupKey);
    return this.resolveRecipients({
      evmRpc: config().EVM_RPC, rest: config().QORE_REST, contract: this.chain.address, board: g.board, groupChainId: g.groupChainId, epoch: g.epoch, epochTx: g.epochTx!,
      members: g.members as never,
    });
  }

  private async load(id: string) {
    const d = await this.db.demo.findUnique({ where: { id } });
    if (!d) throw new ApiError('NOT_FOUND');
    return { ...d, centres: d.centres as { A: Hex; B: Hex } };
  }

  private async logStep(id: string, step: Omit<Step, 'at'>) {
    const d = await this.db.demo.findUnique({ where: { id } });
    const steps = [...((d?.steps as unknown as Step[]) ?? []), { ...step, at: new Date().toISOString() }];
    await this.db.demo.update({ where: { id }, data: { steps: steps as unknown as object } });
    this.log.log(`demo ${id} beat ${step.beat} ${step.name}: ${step.ok ? 'ok' : 'refused'} — ${step.summary}`);
  }

  private explorer = (tx: string) => (tx?.startsWith('0x') ? `${this.chain.explorer}/tx/${tx}` : tx);

  // ── beat 1: set ──

  async start(ip: string) {
    await this.limits.hit(`demo:${ip}`, 5, 60 * 60_000);
    const keys = this.keys();
    const s = Object.fromEntries(await Promise.all(DEMO_ROLES.map(async (r) => [r, await this.session(r)]))) as Record<DemoRole, Session>;
    return this.locks.withLock(LOCK.demo, async () => {
      const board = keys.board;
      const salt = toHex(randomBytes(32)) as Hex;
      const examId = examIdFor(board.evm, salt).toLowerCase() as Hex;
      const centres = { A: toHex(randomBytes(32)) as Hex, B: toHex(randomBytes(32)) as Hex };
      const part = (k: RoleKey) => ({ address: k.evm, recipient: k.recipient });
      const setup = await setExam({ paperMarkdown: SAMPLE_PAPER, examId, examiners: [part(keys.examiner1), part(keys.examiner2), part(keys.examiner3)], board: part(board), centreIds: [centres.A, centres.B] });
      const startTime = Number((await this.chain.client.getBlock()).timestamp) + DEMO_START_DELAY_S;
      const examiners = [keys.examiner1.evm, keys.examiner2.evm, keys.examiner3.evm] as [Hex, Hex, Hex];
      const txs: string[] = [];
      const created = await this.exams.create(s.board, {
        title: 'Judge mode — DEMO (testnet only)', salt, startTime, examiners, masterCommitment: setup.masterCommitment, committeeBlob: b64url(setup.committeeEnvelope),
        signature: await this.sign('board', Action.CreateExam, { salt, board: board.evm, examiners, startTime: BigInt(startTime), masterCommitment: setup.masterCommitment, committeeBundleHash: setup.committeeBundleHash } as never),
      });
      txs.push(created.txHash);
      const demo = await this.db.demo.create({ data: { examId, ip, centres, startTime: new Date(startTime * 1000), steps: [] } });
      for (const c of setup.centres) {
        const r = await this.exams.setCentre(s.board, examId, {
          name: c.centreId === centres.A ? 'Centre A' : 'Centre B', centreId: c.centreId, commitment: c.commitment, cipherBlob: b64url(c.cipher), shares: c.shares.map((x) => b64url(x)) as [string, string, string],
          signature: await this.sign('board', Action.SetCentre, { examId, centreId: c.centreId, commitment: c.commitment, cipherHash: c.cipherHash } as never),
        });
        txs.push(r.txHash);
      }
      const bg = new BoardGroups();
      const addGroup = async (groupKey: string, roles: DemoRole[], role: 'invigilator' | 'marker') => {
        const rot = bg.create(groupKey, Object.fromEntries(roles.map((r) => [keys[r].evm, keys[r].recipient])));
        const r = await this.groups.add(s.board, groupKey, {
          addresses: roles.map((x) => keys[x].evm), role, envelope: b64url(rot.envelope!), epoch: Number(rot.epoch), membersHash: rot.membersHash,
          signature: await this.sign('board', Action.RotateEpoch, { centreId: groupChainId(groupKey), board: board.evm, epoch: rot.epoch, membersHash: rot.membersHash, envelopeHash: rot.envelopeHash } as never),
          sealedBoardState: b64url(bg.exportSealed(board.recipient)),
        });
        txs.push(r.txHash);
      };
      await addGroup(centreGroupKey(centres.A), ['invigilatorA1', 'invigilatorA2'], 'invigilator');
      await addGroup(centreGroupKey(centres.B), ['invigilatorB1'], 'invigilator');
      await addGroup(markersGroupKey(examId), ['marker1', 'marker2'], 'marker');
      await this.db.demo.update({ where: { id: demo.id }, data: { boardState: new Uint8Array(bg.exportSealed(board.recipient)) } });
      await this.logStep(demo.id, { beat: 1, name: 'set', ok: true, summary: 'exam, 2 centres (2-of-3 shares sealed to the examiners), invigilator and marker groups', txs });

      // canary variants: the board is a committee member, so it can open the bundle and re-derive every copy
      const committee = openCommitteeBundle({ envelope: setup.committeeEnvelope, keys: board.seal, examId });
      return {
        demoId: demo.id,
        examId,
        startTime: new Date(startTime * 1000).toISOString(),
        startsInSeconds: Math.max(0, startTime - Math.floor(Date.now() / 1000)),
        centres,
        roles: Object.fromEntries(DEMO_ROLES.map((r) => [r, { label: LABEL[r], address: keys[r].evm, roleAddress: keys[r].address }])),
        roleLinks: Object.fromEntries(DEMO_ROLES.map((r) => [r, `/demo/${demo.id}/as/${r}`])),
        txs: txs.map((t) => ({ tx: t, explorer: this.explorer(t) })),
        variants: {
          master: committee.copies.master.text,
          A: committee.copies.centres[centres.A].text,
          B: committee.copies.centres[centres.B].text,
          commitments: { master: setup.masterCommitment, A: setup.centres[0].commitment, B: setup.centres[1].commitment },
          minPairDistanceBits: committee.copies.minPairDistance,
          differences: this.differences(committee, centres),
        },
        label: 'DEMO — testnet only. Demo keys are held by this server; real users keep their own keys.',
      };
    });
  }

  /** Per-question canary differences between centre A's and centre B's copies (for the UI diff). */
  private differences(committee: ReturnType<typeof openCommitteeBundle>, centres: { A: Hex; B: Hex }) {
    const a = committee.copies.centres[centres.A];
    const b = committee.copies.centres[centres.B];
    const where = (t: typeof a, sec: number, qi: number) => t.table.questionOrder[sec].indexOf(qi);
    const out: { section: number; canonical: number; positionA: number; positionB: number; optionOrderA: number[]; optionOrderB: number[] }[] = [];
    committee.paper.sections.forEach((s, si) =>
      s.questions.forEach((q, qi) =>
        out.push({ section: si + 1, canonical: q.index + 1, positionA: where(a, si, qi) + 1, positionB: where(b, si, qi) + 1, optionOrderA: a.table.optionOrder[q.index], optionOrderB: b.table.optionOrder[q.index] }),
      ),
    );
    const togglesDiffer = a.table.toggles.filter((t, i) => t !== b.table.toggles[i]).length;
    return { questions: out, togglesDiffer, toggles: a.table.toggles.length };
  }

  // ── beats 2–5: acts ──

  async act(id: string, as: string, action: string, params: Record<string, string> = {}) {
    const d = await this.load(id);
    if (!(DEMO_ROLES as readonly string[]).includes(as) && as !== 'candidates') throw new ApiError('VALIDATION_FAILED', { fields: 'as' });
    return this.locks.withLock(LOCK.demo, async () => {
      if (action === 'release' && /^examiner[123]$/.test(as)) return this.doRelease(d, as as DemoRole, (params.centre as 'A' | 'B') ?? 'A');
      if (action === 'open' && CENTRE_OF[as as DemoRole]) return this.doOpen(d, as as DemoRole);
      if (action === 'remove-invigilator' && as === 'board') return this.doRemove(d, (params.target as DemoRole) ?? 'invigilatorA2');
      if (action === 'submit-scripts' && as === 'candidates') return this.doScripts(d);
      throw new ApiError('VALIDATION_FAILED', { fields: 'action' });
    });
  }

  private async doRelease(d: Awaited<ReturnType<DemoService['load']>>, role: DemoRole, centre: 'A' | 'B') {
    const k = this.keys()[role];
    const s = await this.session(role);
    const centreId = d.centres[centre];
    const exam = await this.db.exam.findUnique({ where: { onchainId: d.examId } });
    const early = Date.now() < d.startTime.getTime();
    try {
      const share = await this.release.myShare(s, d.examId, centreId);
      const g = await this.members.publicState(exam!.boardAddr, centreGroupKey(centreId));
      const recipients = await this.verifiedRecipients(exam!.boardAddr, centreGroupKey(centreId));
      const r = prepareRelease({ shareEnvelope: fromB64url(share.sealedToExaminer), examinerKeys: k.seal, examinerIndex: share.examinerIndex, examId: d.examId as Hex, centreId, epoch: g.epoch, invigilators: recipients });
      const out = await this.release.release(s, d.examId, centreId, {
        releasedBlob: b64url(r.blob), blobHash: r.blobHash, epoch: g.epoch,
        signature: await this.sign(role, Action.Release, { examId: d.examId, centreId, blobHash: r.blobHash, examiner: k.evm, epoch: BigInt(g.epoch) } as never),
      });
      await this.logStep(d.id, { beat: 3, name: `release by ${role}`, ok: true, summary: `centre ${centre}: ${out.count} of 2${out.released ? ' → Released' : ''}`, txs: [out.txHash] });
      return { beat: 3, ok: true, centre, ...out, explorer: this.explorer(out.txHash) };
    } catch (e) {
      if (e instanceof ApiError) {
        await this.logStep(d.id, { beat: early ? 2 : 3, name: `release by ${role}`, ok: false, summary: `${e.code}: ${e.message}`, txs: [] });
        if (e.code === 'TOO_EARLY') return { beat: 2, ok: false, refusedByContract: true, error: { code: e.code, message: e.message }, note: 'PaperTrail.release reverted TooEarly in a real simulation on diana; nothing was sent.' };
      }
      throw e;
    }
  }

  private async doOpen(d: Awaited<ReturnType<DemoService['load']>>, role: DemoRole) {
    const k = this.keys()[role];
    const centre = CENTRE_OF[role]!;
    const centreId = d.centres[centre];
    const rel = await this.release.released(d.examId, centreId);
    const result: Record<string, unknown> = { beat: 4, as: role, centre };
    try {
      const opened = await openPaper({
        released: rel.released.map((x) => ({ blob: fromB64url(x.blob), epoch: x.epoch! })), invigilatorKeys: k.seal, examId: d.examId as Hex, centreId,
        cipher: fromB64url(rel.cipherBlob), commitment: rel.commitment as Hex,
      });
      Object.assign(result, { opened: true, authentic: opened.authentic, commitment: rel.commitment, paper: opened.text });
    } catch (e) {
      Object.assign(result, { opened: false, error: (e as { code?: string }).code ?? (e as Error).message });
    }
    // documents after a removal: the group's newest epoch key and any submitted script
    const exam = await this.db.exam.findUnique({ where: { onchainId: d.examId } });
    const envs = await this.groups.epochs(centreGroupKey(centreId), exam!.boardAddr, 0);
    const later: { what: string; result: string }[] = [];
    const latest = envs[envs.length - 1];
    if (latest && latest.epoch > 1) {
      try {
        openGroupEpoch({ groupKey: centreGroupKey(centreId), envelope: fromB64url(latest.envelope), keys: k.seal });
        later.push({ what: `centre ${centre} group key, epoch ${latest.epoch}`, result: 'opened' });
      } catch (e) {
        later.push({ what: `centre ${centre} group key, epoch ${latest.epoch}`, result: (e as { code?: string }).code ?? 'refused' });
      }
    }
    const script = await this.db.script.findFirst({ where: { examId: d.examId, centreId, txHash: { not: null } } });
    if (script) {
      try {
        openScript({ envelope: script.blob, keys: k.seal, examId: d.examId, centreId, pseudonymHash: script.pseudonymHash });
        later.push({ what: 'a candidate script', result: 'opened' });
      } catch {
        later.push({ what: 'a candidate script', result: 'NOT_A_RECIPIENT' });
      }
    }
    if (later.length) result.laterDocuments = later;
    const ok = result.opened === true;
    await this.logStep(d.id, {
      beat: later.length ? 5 : 4, name: `${role} opens centre ${centre}`, ok,
      summary: `${ok ? 'Authentic ✓ (matches the on-chain commitment)' : `cannot open: ${result.error}`}${later.length ? `; later documents: ${later.map((x) => `${x.what} → ${x.result}`).join(', ')}` : ''}`, txs: [],
    });
    return result;
  }

  private async doRemove(d: Awaited<ReturnType<DemoService['load']>>, target: DemoRole) {
    if (!['invigilatorA1', 'invigilatorA2', 'invigilatorB1'].includes(target)) throw new ApiError('VALIDATION_FAILED', { fields: 'target' });
    const keys = this.keys();
    const s = await this.session('board');
    const centreId = d.centres[CENTRE_OF[target]!];
    const groupKey = centreGroupKey(centreId);
    const bg = BoardGroups.restoreSealed(d.boardState!, keys.board.seal);
    const rot = bg.remove(groupKey, keys[target].evm);
    const r = await this.groups.remove(s, groupKey, keys[target].evm, {
      envelope: b64url(rot.envelope!), epoch: Number(rot.epoch), membersHash: rot.membersHash,
      signature: await this.sign('board', Action.RotateEpoch, { centreId: groupChainId(groupKey), board: keys.board.evm, epoch: rot.epoch, membersHash: rot.membersHash, envelopeHash: rot.envelopeHash } as never),
      sealedBoardState: b64url(bg.exportSealed(keys.board.recipient)),
    });
    await this.db.demo.update({ where: { id: d.id }, data: { boardState: new Uint8Array(bg.exportSealed(keys.board.recipient)) } });
    await this.logStep(d.id, { beat: 5, name: `board removes ${target}`, ok: true, summary: `centre group → epoch ${r.epoch} (${r.members.length} member${r.members.length === 1 ? '' : 's'})`, txs: [r.txHash] });
    return { beat: 5, ok: true, removed: target, epoch: r.epoch, members: r.members, txHash: r.txHash, explorer: this.explorer(r.txHash) };
  }

  private async doScripts(d: Awaited<ReturnType<DemoService['load']>>) {
    const s = await this.session('board');
    const exam = await this.db.exam.findUnique({ where: { onchainId: d.examId } });
    const markers = await this.verifiedRecipients(exam!.boardAddr, markersGroupKey(d.examId));
    const g = await this.members.publicState(exam!.boardAddr, markersGroupKey(d.examId));
    const { tickets } = await this.scripts.tickets(s, d.examId, { centreId: d.centres.A, count: CANDIDATES });
    const pseudonyms: string[] = [];
    for (let i = 0; i < CANDIDATES; i++) {
      const ps = newPseudonym();
      pseudonyms.push(ps);
      const sc = sealScript({ examId: d.examId, centreId: d.centres.A, pseudonym: ps, answers: { candidateBot: i + 1, q1: i % 4, q2: (i + 1) % 4 }, markers });
      await this.scripts.submit(d.examId, { centreId: d.centres.A, pseudonymHash: sc.pseudonymHash, blob: b64url(sc.envelope), scriptHash: sc.scriptHash, markerEpoch: g.epoch, ticket: tickets[i] }, `demo:${d.id}`);
    }
    const pending = await this.scripts.pending(s, d.examId);
    let nonce = await this.chain.nonceOf(this.keys().board.evm);
    const items = [];
    for (const p of pending)
      items.push({ scriptId: p.scriptId, signature: await this.sign('board', Action.SubmitScript, { examId: d.examId, centreId: p.centreId, pseudonymHash: p.pseudonymHash, scriptHash: p.scriptHash, markerEpoch: BigInt(p.markerEpoch) } as never, nonce++) });
    const r = await this.scripts.relayBatch(s, d.examId, { items });
    await this.db.demo.update({ where: { id: d.id }, data: { scripts: { pseudonyms } } });
    await this.logStep(d.id, { beat: 5, name: `${CANDIDATES} candidate bots submit scripts`, ok: true, summary: `sealed to the ${markers.length} markers (verified against the chain), recorded on chain`, txs: r.submitted.map((x) => x.txHash) });
    return { beat: 5, ok: true, submitted: r.submitted.map((x) => ({ ...x, explorer: this.explorer(x.txHash) })), sealedTo: g.members.map((m) => m.address) };
  }

  // ── beat 6: leak ──

  async leak(id: string, centre: 'A' | 'B' = 'B') {
    const d = await this.load(id);
    const keys = this.keys();
    const exam = await this.db.exam.findUnique({ where: { onchainId: d.examId }, include: { centres: true } });
    const committee = openCommitteeBundle({ envelope: exam!.committeeBlob, keys: keys.board.seal, examId: d.examId as Hex });
    const leaked = simulateLeak(committee.copies.centres[d.centres[centre]].text, 3, Date.now() & 0xffff);
    const m = matchLeak(leaked, committee.paper, committee.tables);
    const name = m.copy === d.centres.A ? 'Centre A' : m.copy === d.centres.B ? 'Centre B' : m.copy === 'master' ? 'the master copy (committee)' : null;
    const traced = m.copy ? (m.copy === 'master' ? null : exam!.centres.find((c) => c.onchainId === m.copy)) : null;
    let group: Record<string, unknown> | null = null;
    if (traced) {
      const g = await this.members.publicState(exam!.boardAddr, centreGroupKey(traced.onchainId));
      group = { epoch: g.epoch, recipients: g.members.map((x) => ({ address: x.address, roleAddress: x.roleAddress })), epochTx: g.epochTx, epochExplorer: g.epochTx ? this.explorer(g.epochTx) : null };
    }
    await this.logStep(d.id, { beat: 6, name: 'leak traced', ok: !!name, summary: `excerpt of centre ${centre}'s copy → ${name ?? 'no attribution'} (confidence ${m.confidence.toFixed(2)}, ${m.matchedBits}/${m.observedBits} bits)`, txs: [] });
    return {
      beat: 6,
      leakedExcerpt: leaked,
      result: { copy: name, confidence: m.confidence, matchedBits: m.matchedBits, observedBits: m.observedBits, distanceToRunnerUp: m.distanceToRunnerUp },
      centre: traced ? { centreId: traced.onchainId, name: traced.name, commitment: traced.commitment, setTx: traced.setTx, setExplorer: traced.setTx ? this.explorer(traced.setTx) : null, ...group } : null,
      note: 'Canary attribution names the centre whose copy leaked, or the committee (which holds every copy).',
    };
  }

  // ── state ──

  async get(id: string) {
    const d = await this.load(id);
    const view = await this.exams.view(d.examId);
    return {
      demoId: d.id, examId: d.examId, startTime: d.startTime.toISOString(), startsInSeconds: Math.max(0, Math.ceil((d.startTime.getTime() - Date.now()) / 1000)), centres: d.centres,
      steps: d.steps, exam: view, audit: `/exams/${d.examId}/audit`, events: `/exams/${d.examId}/events`,
    };
  }
}
