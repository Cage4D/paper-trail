/**
 * Scripts, marks and published results (spec §7.3).
 *  - A candidate posts a script sealed to the exam's CURRENT markers (QoreSeal), under a
 *    pseudonym. It is accepted only for a centre whose `Released` event is indexed, and only if
 *    it is sealed to exactly the markers of the exam board's markers group at `markerEpoch`.
 *  - The board signs PaperTrail.submitScript for pending scripts; the relayer sends them as a
 *    batch, in order.
 *  - Markers (active in the markers group) see the queue and post marks; they only ever see
 *    pseudonyms.
 *  - The board publishes the marks' Merkle root (core buildMarksTree). The API recomputes it
 *    from the stored marks before relaying. Candidates fetch a proof for their pseudonym.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Hex } from 'viem';
import { Action, buildMarksTree, groupChainId, markersGroupKey, pseudonymHash, sealedToExactly, type MarkEntry } from '@paper-trail/core';
import type { MarkBody, PublishMarksBody, ScriptBody, SubmitScriptsBody } from '@paper-trail/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { RelayerService } from '../relayer/relayer.service.js';
import { IndexerService } from '../chain/indexer.service.js';
import { MemberKeysService } from '../groups/members.js';
import { ApiError } from '../common/api-error.js';
import { decodeBlob, sha3Hex, toB64url } from '../common/bytes.js';
import type { Session } from '../auth/session.js';

@Injectable()
export class ScriptsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(RelayerService) private readonly relayer: RelayerService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
    @Inject(MemberKeysService) private readonly keys: MemberKeysService,
  ) {}

  private async exam(examId: string) {
    const e = /^0x[0-9a-fA-F]{64}$/.test(examId) ? await this.db.exam.findUnique({ where: { onchainId: examId.toLowerCase() } }) : null;
    if (!e) throw new ApiError('NOT_FOUND');
    return e;
  }

  private async isMarker(boardAddr: string, examId: string, evm: string) {
    return (await this.keys.active(boardAddr, markersGroupKey(examId))).includes(evm);
  }

  /** Candidate client: no session (candidates have no role keys in v1). */
  async submit(examId: string, b: ScriptBody) {
    await this.indexer.catchUp().catch(() => null);
    const exam = await this.exam(examId);
    const centre = await this.db.centre.findUnique({ where: { examId_onchainId: { examId: exam.id, onchainId: b.centreId.toLowerCase() } } });
    if (!centre) throw new ApiError('NOT_FOUND');
    if (!centre.released) throw new ApiError('NOT_RELEASED', { count: 0 });
    const blob = decodeBlob(b.blob, 'blob', 1024 * 1024);
    if (sha3Hex(blob) !== b.scriptHash.toLowerCase()) throw new ApiError('VALIDATION_FAILED', { fields: 'scriptHash' });
    const gk = markersGroupKey(exam.onchainId);
    const markerEpoch = await this.chain.centreEpoch(exam.boardAddr as Hex, groupChainId(gk) as Hex);
    if (!markerEpoch || b.markerEpoch !== markerEpoch) throw new ApiError('VALIDATION_FAILED', { fields: `markerEpoch (current is ${markerEpoch})` });
    const markers = await this.keys.resolve(await this.keys.active(exam.boardAddr, gk));
    if (!sealedToExactly(blob, markers.map((m) => m.mlkemPublicKey))) throw new ApiError('VALIDATION_FAILED', { fields: 'blob (not sealed to exactly the current markers)' });
    if (await this.db.script.findUnique({ where: { examId_pseudonymHash: { examId: exam.onchainId, pseudonymHash: b.pseudonymHash.toLowerCase() } } })) throw new ApiError('CONFLICT');
    const s = await this.db.script.create({ data: { examId: exam.onchainId, centreId: centre.onchainId, pseudonymHash: b.pseudonymHash.toLowerCase(), blob, scriptHash: b.scriptHash.toLowerCase(), markerEpoch } });
    return { scriptId: s.id, txHash: null };
  }

  /** The markers group's current members and epoch (what a candidate seals to). */
  async markers(examId: string) {
    const exam = await this.exam(examId);
    const gk = markersGroupKey(exam.onchainId);
    const epoch = await this.chain.centreEpoch(exam.boardAddr as Hex, groupChainId(gk) as Hex);
    const members = await this.keys.resolve(await this.keys.active(exam.boardAddr, gk));
    return { groupKey: gk, epoch, members: members.map((m) => ({ address: m.address, roleAddress: m.roleAddress, mlkemPublicKey: toB64url(m.mlkemPublicKey), x25519PublicKey: m.x25519PublicKey })) };
  }

  async pending(s: Session, examId: string) {
    const exam = await this.exam(examId);
    if (exam.boardAddr !== s.evm) throw new ApiError('FORBIDDEN');
    const rows = await this.db.script.findMany({ where: { examId: exam.onchainId, txHash: null }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ scriptId: r.id, centreId: r.centreId, pseudonymHash: r.pseudonymHash, scriptHash: r.scriptHash, markerEpoch: r.markerEpoch }));
  }

  /** Board relays signed submitScript actions in order; stops at the first failure (nonce order). */
  async relayBatch(s: Session, examId: string, b: SubmitScriptsBody) {
    const exam = await this.exam(examId);
    if (exam.boardAddr !== s.evm) throw new ApiError('FORBIDDEN');
    const out: { scriptId: string; txHash: string }[] = [];
    for (const it of b.items) {
      const sc = await this.db.script.findUnique({ where: { id: it.scriptId } });
      if (!sc || sc.examId !== exam.onchainId) throw new ApiError('NOT_FOUND');
      if (sc.txHash) continue;
      const r = await this.relayer.relay(
        Action.SubmitScript, s.evm,
        { examId: exam.onchainId as Hex, centreId: sc.centreId as Hex, pseudonymHash: sc.pseudonymHash as Hex, scriptHash: sc.scriptHash as Hex, markerEpoch: BigInt(sc.markerEpoch) },
        it.signature as Hex,
      );
      await this.db.script.update({ where: { id: sc.id }, data: { txHash: r.txHash } });
      out.push({ scriptId: sc.id, txHash: r.txHash });
    }
    await this.indexer.catchUp(true).catch(() => null);
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
    if (exam.marksRoot) throw new ApiError('CONFLICT');
    if (!(await this.isMarker(exam.boardAddr, exam.onchainId, s.evm))) throw new ApiError('NOT_A_MEMBER');
    const fb = b.sealedFeedback ? decodeBlob(b.sealedFeedback, 'sealedFeedback') : null;
    await this.db.mark.upsert({ where: { scriptId_markerAddr: { scriptId, markerAddr: s.evm } }, create: { scriptId, markerAddr: s.evm, score: b.score, sealedFeedback: fb }, update: { score: b.score, sealedFeedback: fb } });
    return { ok: true };
  }

  /** One score per submitted, marked script: the most recent mark. */
  private async entries(examOnchainId: string): Promise<MarkEntry[]> {
    const scripts = await this.db.script.findMany({ where: { examId: examOnchainId, txHash: { not: null } } });
    const marks = await this.db.mark.findMany({ where: { scriptId: { in: scripts.map((x) => x.id) } }, orderBy: { createdAt: 'desc' } });
    return scripts.flatMap((sc) => {
      const m = marks.find((x) => x.scriptId === sc.id);
      return m ? [{ pseudonymHash: sc.pseudonymHash as `0x${string}`, score: m.score }] : [];
    });
  }

  async markEntries(s: Session, examId: string) {
    const exam = await this.exam(examId);
    if (exam.boardAddr !== s.evm) throw new ApiError('FORBIDDEN');
    return { entries: await this.entries(exam.onchainId) };
  }

  async publish(s: Session, examId: string, b: PublishMarksBody) {
    const exam = await this.exam(examId);
    if (exam.boardAddr !== s.evm) throw new ApiError('FORBIDDEN');
    if (exam.marksRoot) throw new ApiError('CONFLICT');
    const entries = await this.entries(exam.onchainId);
    if (!entries.length) throw new ApiError('VALIDATION_FAILED', { fields: 'marks (none yet)' });
    if (buildMarksTree(entries).root !== b.merkleRoot.toLowerCase()) throw new ApiError('VALIDATION_FAILED', { fields: 'merkleRoot (does not match the stored marks)' });
    const r = await this.relayer.relay(Action.PublishMarks, s.evm, { examId: exam.onchainId as Hex, merkleRoot: b.merkleRoot as Hex }, b.signature as Hex);
    await this.db.exam.update({ where: { id: exam.id }, data: { marksRoot: b.merkleRoot.toLowerCase(), marksTx: r.txHash } });
    await this.indexer.catchUp(true).catch(() => null);
    return { txHash: r.txHash, merkleRoot: b.merkleRoot.toLowerCase(), count: entries.length };
  }

  async proof(examId: string, pseudonym: string) {
    const exam = await this.exam(examId);
    if (!exam.marksRoot) throw new ApiError('NOT_FOUND');
    const ph = pseudonymHash(exam.onchainId, pseudonym);
    const entries = await this.entries(exam.onchainId);
    const e = entries.find((x) => x.pseudonymHash === ph);
    if (!e) throw new ApiError('NOT_FOUND');
    const tree = buildMarksTree(entries);
    return { pseudonymHash: ph, score: e.score, proof: tree.proof(ph), merkleRoot: exam.marksRoot, publishTx: exam.marksTx };
  }
}
