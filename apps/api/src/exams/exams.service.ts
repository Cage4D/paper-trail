/**
 * Exams and centres (spec §7.3). The API stores ciphertexts, sealed envelopes and hashes only;
 * every state change is relayed as the board's ML-DSA-87-signed action and checked on chain.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Hex } from 'viem';
import { Action, examIdFor } from '@paper-trail/core';
import type { CreateExamBody, SetCentreBody } from '@paper-trail/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { RelayerService } from '../relayer/relayer.service.js';
import { IndexerService } from '../chain/indexer.service.js';
import { ApiError, maybeSent } from '../common/api-error.js';
import { ChainService } from '../chain/chain.service.js';
import { decodeBlob, lower, sha3Hex, toB64url } from '../common/bytes.js';
import type { Session } from '../auth/session.js';

@Injectable()
export class ExamsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(RelayerService) private readonly relayer: RelayerService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
    @Inject(ChainService) private readonly chain: ChainService,
  ) {}

  /**
   * A row from an earlier attempt: done → CONFLICT; relay still pending → RELAYER_BUSY (keep it);
   * failed / never relayed → the caller may replace it (bug-hunt finding 2).
   */
  private async retryable(ref: string, done: boolean): Promise<void> {
    if (done) throw new ApiError('CONFLICT');
    const job = await this.relayer.jobFor(ref);
    if (job && job.status !== 'FAILED') throw ApiError.pending(job.txHash ?? '');
  }

  async create(s: Session, b: CreateExamBody) {
    if (b.startTime <= Math.floor(Date.now() / 1000) + 30) throw new ApiError('VALIDATION_FAILED', { fields: 'startTime' });
    const examiners = b.examiners.map(lower) as [Hex, Hex, Hex];
    if (new Set(examiners).size !== 3) throw new ApiError('VALIDATION_FAILED', { fields: 'examiners' });
    const committee = decodeBlob(b.committeeBlob, 'committeeBlob');
    const committeeHash = sha3Hex(committee);
    const board = s.evm;
    const onchainId = examIdFor(board, b.salt as Hex).toLowerCase();
    const ref = `exam:${onchainId}`;
    const prev = await this.db.exam.findUnique({ where: { onchainId } });
    if (prev) {
      await this.retryable(ref, prev.status === 'CREATED');
      await this.db.exam.delete({ where: { id: prev.id } });
    }
    const exam = await this.db.exam.create({
      data: {
        onchainId, salt: b.salt.toLowerCase(), title: b.title, boardAddr: board, examiners, startTime: new Date(b.startTime * 1000),
        masterCommitment: b.masterCommitment.toLowerCase(), committeeBlob: committee, committeeHash,
      },
    });
    try {
      const r = await this.relayer.relay(
        Action.CreateExam,
        board,
        { salt: b.salt as Hex, board, examiners, startTime: BigInt(b.startTime), masterCommitment: b.masterCommitment as Hex, committeeBundleHash: committeeHash },
        b.signature as Hex,
        { ref, examId: onchainId },
      );
      await this.db.exam.update({ where: { id: exam.id }, data: { createTx: r.txHash } });
      return { id: exam.id, examId: onchainId, onchainId, txHash: r.txHash, windowReopened: r.windowReopened ?? null };
    } catch (e) {
      // may have landed (receipt timed out): keep the row; ExamCreated / reconciliation will settle it
      if (!maybeSent(e)) await this.db.exam.delete({ where: { id: exam.id } }).catch(() => undefined);
      throw e;
    }
  }

  async setCentre(s: Session, examId: string, b: SetCentreBody) {
    const exam = await this.examOr404(examId);
    if (exam.boardAddr !== s.evm) throw new ApiError('FORBIDDEN');
    const centreId = b.centreId.toLowerCase();
    const ref = `centre:${exam.onchainId}:${centreId}`;
    const prev = await this.db.centre.findUnique({ where: { examId_onchainId: { examId: exam.id, onchainId: centreId } } });
    if (prev) {
      await this.retryable(ref, prev.confirmed);
      await this.db.$transaction([
        this.db.shareBlob.deleteMany({ where: { examId: exam.onchainId, centreId } }),
        this.db.centre.delete({ where: { id: prev.id } }),
      ]);
    }
    // a board can reuse a centre whose group already rotated: start from the chain's epoch (finding 8)
    const epochNow = await this.chain.centreEpoch(exam.boardAddr as Hex, centreId as Hex).catch(() => 0);
    const cipher = decodeBlob(b.cipherBlob, 'cipherBlob', 4 * 1024 * 1024);
    const cipherHash = sha3Hex(cipher);
    const shares = b.shares.map((x, i) => decodeBlob(x, `shares.${i}`));
    const centre = await this.db.$transaction(async (tx) => {
      const c = await tx.centre.create({ data: { examId: exam.id, onchainId: centreId, name: b.name, commitment: b.commitment.toLowerCase(), cipherBlob: cipher, cipherHash, currentEpoch: epochNow } });
      await tx.shareBlob.createMany({
        data: shares.map((sh, i) => ({ examId: exam.onchainId, centreId, examinerAddr: exam.examiners[i], examinerIndex: i, sealedToExaminer: sh })),
      });
      return c;
    });
    try {
      const r = await this.relayer.relay(Action.SetCentre, s.evm, { examId: exam.onchainId as Hex, centreId: centreId as Hex, commitment: b.commitment as Hex, cipherHash }, b.signature as Hex, { ref, examId: exam.onchainId });
      await this.db.centre.update({ where: { id: centre.id }, data: { setTx: r.txHash } });
      return { centreId, txHash: r.txHash, cipherHash, windowReopened: r.windowReopened ?? null };
    } catch (e) {
      if (maybeSent(e)) throw e; // keep the ciphertext and shares: the centre may be set on chain
      await this.db.$transaction([
        this.db.shareBlob.deleteMany({ where: { examId: exam.onchainId, centreId } }),
        this.db.centre.delete({ where: { id: centre.id } }),
      ]).catch(() => undefined);
      throw e;
    }
  }

  /** Public view (spec §7.3 GET /exams/:id). */
  async view(examId: string) {
    await this.indexer.catchUp().catch(() => null);
    const exam = await this.examOr404(examId, true);
    const shares = await this.db.shareBlob.findMany({ where: { examId: exam.onchainId }, select: { centreId: true, examinerAddr: true, releaseTx: true } });
    return {
      examId: exam.onchainId,
      title: exam.title,
      status: exam.status,
      board: exam.boardAddr,
      examiners: exam.examiners,
      startTime: exam.startTime.toISOString(),
      masterCommitment: exam.masterCommitment,
      committeeBundleHash: exam.committeeHash,
      createTx: exam.createTx,
      centres: exam.centres.map((c) => ({
        centreId: c.onchainId,
        name: c.name,
        commitment: c.commitment,
        cipherHash: c.cipherHash,
        confirmed: c.confirmed,
        epoch: c.currentEpoch,
        released: c.released,
        releaseCount: shares.filter((x) => x.centreId === c.onchainId && x.releaseTx).length,
        setTx: c.setTx,
      })),
    };
  }

  async committee(s: Session, examId: string) {
    const exam = await this.examOr404(examId);
    if (![exam.boardAddr, ...exam.examiners].includes(s.evm)) throw new ApiError('FORBIDDEN');
    return { committeeBlob: toB64url(exam.committeeBlob), committeeBundleHash: exam.committeeHash };
  }

  async cipher(examId: string, centreId: string) {
    const exam = await this.examOr404(examId);
    const c = await this.db.centre.findUnique({ where: { examId_onchainId: { examId: exam.id, onchainId: centreId.toLowerCase() } } });
    if (!c) throw new ApiError('NOT_FOUND');
    return { cipherBlob: toB64url(c.cipherBlob), cipherHash: c.cipherHash, commitment: c.commitment };
  }

  private async examOr404(examId: string, withCentres = false) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(examId)) throw new ApiError('NOT_FOUND');
    const exam = await this.db.exam.findUnique({ where: { onchainId: examId.toLowerCase() }, include: { centres: withCentres } });
    if (!exam) throw new ApiError('NOT_FOUND');
    return exam;
  }
}
