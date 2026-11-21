/**
 * Scripts, marks and published results (spec §7.3).
 *  - The board issues single-use admission TICKETS per centre; a candidate posts a script sealed
 *    to the exam's CURRENT markers (as the chain sees the group) with one ticket. Accepted only
 *    for a centre whose `Released` event is indexed, only while marking is open, and rate-limited
 *    per IP (bug-hunt finding 5).
 *  - The board signs PaperTrail.submitScript for pending scripts; the relayer sends them in order
 *    (ScriptSubmitted confirms each).
 *  - Markers (members of the markers group's current epoch) see the queue and post marks; they
 *    only ever see pseudonyms. The latest mark per script counts (by updatedAt, finding 7).
 *  - Publishing FREEZES marking first (marksStatus PUBLISHING), snapshots the exact entries, checks
 *    the board's root against them, then relays publishMarks. Proofs come from the snapshot, so a
 *    late mark can never invalidate the published root (finding 6).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Hex } from 'viem';
import { Action, b64url, buildMarksTree, markersGroupKey, pseudonymHash, randomBytes, sealedToExactly, sha3Hex as coreSha3, utf8, type MarkEntry } from '@paper-trail/core';
import type { IdentityMapBody, MarkBody, PublishMarksBody, ScriptBody, SubmitScriptsBody, TicketsBody } from '@paper-trail/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { RelayerService } from '../relayer/relayer.service.js';
import { IndexerService } from '../chain/indexer.service.js';
import { MemberKeysService } from '../groups/members.js';
import { RateLimitService } from '../common/rate-limit.service.js';
import { ApiError, maybeSent } from '../common/api-error.js';
import { decodeBlob, sha3Hex, toB64url } from '../common/bytes.js';
import type { Session } from '../auth/session.js';

const ticketHash = (t: string) => coreSha3(utf8(`papertrail:ticket:v1|${t}`));

@Injectable()
export class ScriptsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(RelayerService) private readonly relayer: RelayerService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
    @Inject(MemberKeysService) private readonly keys: MemberKeysService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  private async exam(examId: string) {
    const e = /^0x[0-9a-fA-F]{64}$/.test(examId) ? await this.db.exam.findUnique({ where: { onchainId: examId.toLowerCase() } }) : null;
    if (!e) throw new ApiError('NOT_FOUND');
    return e;
  }

  private async board(s: Session, examId: string) {
    const e = await this.exam(examId);
    if (e.boardAddr !== s.evm) throw new ApiError('FORBIDDEN');
    return e;
  }

  private async isMarker(boardAddr: string, examId: string, evm: string) {
    return (await this.keys.current(boardAddr, markersGroupKey(examId))).members.includes(evm);
  }

  /** Board: issue single-use admission tickets for a centre (hand one to each candidate). */
  async tickets(s: Session, examId: string, b: TicketsBody) {
    const exam = await this.board(s, examId);
    const centre = await this.db.centre.findUnique({ where: { examId_onchainId: { examId: exam.id, onchainId: b.centreId.toLowerCase() } } });
    if (!centre) throw new ApiError('NOT_FOUND');
    const tickets = Array.from({ length: b.count }, () => `pt_${b64url(randomBytes(16))}`);
    await this.db.scriptTicket.createMany({ data: tickets.map((t) => ({ tokenHash: ticketHash(t), examId: exam.onchainId, centreId: centre.onchainId })) });
    return { centreId: centre.onchainId, tickets };
  }

  /** Candidate client: no session (no role keys in v1); needs a board-issued ticket. */
  async submit(examId: string, b: ScriptBody, ip: string) {
    await this.limits.hit(`scripts:${ip}`, 30, 10 * 60_000);
    await this.indexer.catchUp().catch(() => null);
    const exam = await this.exam(examId);
    if (exam.marksStatus !== 'OPEN') throw new ApiError('CONFLICT');
    const centre = await this.db.centre.findUnique({ where: { examId_onchainId: { examId: exam.id, onchainId: b.centreId.toLowerCase() } } });
    if (!centre) throw new ApiError('NOT_FOUND');
    if (!centre.released) throw new ApiError('NOT_RELEASED', { count: 0 });
    const th = ticketHash(b.ticket);
    const ticket = await this.db.scriptTicket.findUnique({ where: { tokenHash: th } });
    if (!ticket || ticket.usedAt || ticket.examId !== exam.onchainId || ticket.centreId !== centre.onchainId) throw new ApiError('FORBIDDEN');
    const blob = decodeBlob(b.blob, 'blob', 1024 * 1024);
    if (sha3Hex(blob) !== b.scriptHash.toLowerCase()) throw new ApiError('VALIDATION_FAILED', { fields: 'scriptHash' });
    const g = await this.keys.current(exam.boardAddr, markersGroupKey(exam.onchainId));
    if (!g.epoch || b.markerEpoch !== g.epoch) throw new ApiError('VALIDATION_FAILED', { fields: `markerEpoch (current is ${g.epoch})` });
    const markers = await this.keys.resolve(g.members);
    if (!sealedToExactly(blob, markers.map((m) => m.mlkemPublicKey))) throw new ApiError('VALIDATION_FAILED', { fields: 'blob (not sealed to exactly the current markers)' });
    const ph = b.pseudonymHash.toLowerCase();
    if (await this.db.script.findUnique({ where: { examId_pseudonymHash: { examId: exam.onchainId, pseudonymHash: ph } } })) throw new ApiError('CONFLICT');
    // consume the ticket and store the script atomically
    const script = await this.db.$transaction(async (tx) => {
      const used = await tx.scriptTicket.updateMany({ where: { tokenHash: th, usedAt: null }, data: { usedAt: new Date() } });
      if (!used.count) throw new ApiError('FORBIDDEN');
      return tx.script.create({ data: { examId: exam.onchainId, centreId: centre.onchainId, pseudonymHash: ph, blob, scriptHash: b.scriptHash.toLowerCase(), markerEpoch: g.epoch } });
    });
    return { scriptId: script.id, txHash: null };
  }

  /** The markers group's current epoch, membersHash and signed cards (what a candidate seals to). */
  async markers(examId: string) {
    const exam = await this.exam(examId);
    return this.keys.publicState(exam.boardAddr, markersGroupKey(exam.onchainId));
  }

  async pending(s: Session, examId: string) {
    const exam = await this.board(s, examId);
    const rows = await this.db.script.findMany({ where: { examId: exam.onchainId, txHash: null }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ scriptId: r.id, centreId: r.centreId, pseudonymHash: r.pseudonymHash, scriptHash: r.scriptHash, markerEpoch: r.markerEpoch }));
  }

  /** Board relays signed submitScript actions in order; stops at the first failure (nonce order). */
  async relayBatch(s: Session, examId: string, b: SubmitScriptsBody) {
    const exam = await this.board(s, examId);
    const out: { scriptId: string; txHash: string }[] = [];
    for (const it of b.items) {
      const sc = await this.db.script.findUnique({ where: { id: it.scriptId } });
      if (!sc || sc.examId !== exam.onchainId) throw new ApiError('NOT_FOUND');
      if (sc.txHash) continue;
      const ref = `script:${exam.onchainId}:${sc.pseudonymHash}`;
      const prior = await this.relayer.jobFor(ref);
      if (prior && prior.status !== 'FAILED') throw ApiError.pending(prior.txHash ?? '');
      const r = await this.relayer.relay(
        Action.SubmitScript, s.evm,
        { examId: exam.onchainId as Hex, centreId: sc.centreId as Hex, pseudonymHash: sc.pseudonymHash as Hex, scriptHash: sc.scriptHash as Hex, markerEpoch: BigInt(sc.markerEpoch) },
        it.signature as Hex, { ref, examId: exam.onchainId },
      );
      out.push({ scriptId: sc.id, txHash: r.txHash }); // Script.txHash is set by the ScriptSubmitted projection
    }
    return { submitted: out };
  }

  async queue(s: Session, examId: string) {
    const exam = await this.exam(examId);
    if (!(await this.isMarker(exam.boardAddr, exam.onchainId, s.evm))) throw new ApiError('NOT_A_MEMBER');
    const rows = await this.db.script.findMany({ where: { examId: exam.onchainId, txHash: { not: null } }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ scriptId: r.id, centreId: r.centreId, pseudonymHash: r.pseudonymHash, scriptHash: r.scriptHash, markerEpoch: r.markerEpoch, blob: toB64url(r.blob), txHash: r.txHash }));
  }

  async mark(s: Session, scriptId: string, b: MarkBody) {
    const sc = await this.db.script.findUnique({ where: { id: scriptId } });
    if (!sc || !sc.txHash) throw new ApiError('NOT_FOUND');
    const exam = await this.exam(sc.examId);
    if (exam.marksStatus !== 'OPEN') throw new ApiError('CONFLICT'); // frozen once publishing starts
    if (!(await this.isMarker(exam.boardAddr, exam.onchainId, s.evm))) throw new ApiError('NOT_A_MEMBER');
    const fb = b.sealedFeedback ? decodeBlob(b.sealedFeedback, 'sealedFeedback') : null;
    await this.db.mark.upsert({ where: { scriptId_markerAddr: { scriptId, markerAddr: s.evm } }, create: { scriptId, markerAddr: s.evm, score: b.score, sealedFeedback: fb }, update: { score: b.score, sealedFeedback: fb } });
    return { ok: true };
  }

  /** One score per submitted, marked script: the most recently CHANGED mark (finding 7). */
  private async entries(examOnchainId: string): Promise<MarkEntry[]> {
    const scripts = await this.db.script.findMany({ where: { examId: examOnchainId, txHash: { not: null } } });
    const marks = await this.db.mark.findMany({ where: { scriptId: { in: scripts.map((x) => x.id) } }, orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }] });
    return scripts.flatMap((sc) => {
      const m = marks.find((x) => x.scriptId === sc.id);
      return m ? [{ pseudonymHash: sc.pseudonymHash as `0x${string}`, score: m.score }] : [];
    });
  }

  async markEntries(s: Session, examId: string) {
    const exam = await this.board(s, examId);
    return { entries: await this.entries(exam.onchainId) };
  }

  async publish(s: Session, examId: string, b: PublishMarksBody) {
    const exam = await this.board(s, examId);
    const root = b.merkleRoot.toLowerCase();
    const ref = `marks:${exam.onchainId}`;
    if (exam.marksStatus === 'PUBLISHING') {
      const job = await this.relayer.jobFor(ref);
      if (job && job.status !== 'FAILED') throw ApiError.pending(job.txHash ?? '');
      await this.db.exam.update({ where: { id: exam.id }, data: { marksStatus: 'OPEN', marksRoot: null, marksSnapshot: undefined } });
    } else if (exam.marksStatus === 'PUBLISHED') throw new ApiError('CONFLICT');
    // 1. freeze marking first (atomic), 2. snapshot, 3. check the root against the snapshot
    const frozen = await this.db.exam.updateMany({ where: { id: exam.id, marksStatus: 'OPEN' }, data: { marksStatus: 'PUBLISHING' } });
    if (!frozen.count) throw new ApiError('CONFLICT');
    const reopen = () => this.db.exam.update({ where: { id: exam.id }, data: { marksStatus: 'OPEN', marksRoot: null, marksSnapshot: undefined } });
    const entries = await this.entries(exam.onchainId);
    if (!entries.length || buildMarksTree(entries).root !== root) {
      await reopen();
      throw new ApiError('VALIDATION_FAILED', { fields: entries.length ? 'merkleRoot (does not match the stored marks)' : 'marks (none yet)' });
    }
    await this.db.exam.update({ where: { id: exam.id }, data: { marksRoot: root, marksSnapshot: entries as unknown as object } });
    try {
      const r = await this.relayer.relay(Action.PublishMarks, s.evm, { examId: exam.onchainId as Hex, merkleRoot: root as Hex }, b.signature as Hex, { ref, examId: exam.onchainId });
      await this.db.exam.update({ where: { id: exam.id }, data: { marksStatus: 'PUBLISHED', marksTx: r.txHash } });
      return { txHash: r.txHash, merkleRoot: root, count: entries.length };
    } catch (e) {
      if (!maybeSent(e)) await reopen(); // definite failure: marking reopens; pending: stays frozen until MarksPublished
      throw e;
    }
  }

  async proof(examId: string, pseudonym: string) {
    const exam = await this.exam(examId);
    if (exam.marksStatus !== 'PUBLISHED' || !exam.marksRoot || !exam.marksSnapshot) throw new ApiError('NOT_FOUND');
    const entries = exam.marksSnapshot as unknown as MarkEntry[];
    const ph = pseudonymHash(exam.onchainId, pseudonym);
    const e = entries.find((x) => x.pseudonymHash === ph);
    if (!e) throw new ApiError('NOT_FOUND');
    return { pseudonymHash: ph, score: e.score, proof: buildMarksTree(entries).proof(ph), merkleRoot: exam.marksRoot, publishTx: exam.marksTx };
  }

  /** Board: the pseudonym → candidate map, sealed to the board only (spec §4.2/§7.2). */
  async putIdentityMap(s: Session, examId: string, b: IdentityMapBody) {
    const exam = await this.board(s, examId);
    const blob = decodeBlob(b.blob, 'blob', 2 * 1024 * 1024);
    await this.db.identityMap.upsert({ where: { examId: exam.onchainId }, create: { examId: exam.onchainId, blob }, update: { blob } });
    return { ok: true, blobHash: sha3Hex(blob) };
  }

  async getIdentityMap(s: Session, examId: string) {
    const exam = await this.board(s, examId);
    const m = await this.db.identityMap.findUnique({ where: { examId: exam.onchainId } });
    if (!m) throw new ApiError('NOT_FOUND');
    return { blob: toB64url(m.blob) };
  }
}
