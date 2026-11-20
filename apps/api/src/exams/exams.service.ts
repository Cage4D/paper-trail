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
import { ApiError } from '../common/api-error.js';
import { decodeBlob, lower, sha3Hex, toB64url } from '../common/bytes.js';
import type { Session } from '../auth/session.js';

@Injectable()
export class ExamsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(RelayerService) private readonly relayer: RelayerService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
  ) {}

  async create(s: Session, b: CreateExamBody) {
    if (b.startTime <= Math.floor(Date.now() / 1000) + 30) throw new ApiError('VALIDATION_FAILED', { fields: 'startTime' });
    const examiners = b.examiners.map(lower) as [Hex, Hex, Hex];
    if (new Set(examiners).size !== 3) throw new ApiError('VALIDATION_FAILED', { fields: 'examiners' });
    const committee = decodeBlob(b.committeeBlob, 'committeeBlob');
    const committeeHash = sha3Hex(committee);
    const board = s.evm;
    const onchainId = examIdFor(board, b.salt as Hex).toLowerCase();
    if (await this.db.exam.findUnique({ where: { onchainId } })) throw new ApiError('CONFLICT');
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
      );
      await this.db.exam.update({ where: { id: exam.id }, data: { createTx: r.txHash } });
      await this.indexer.catchUp(true).catch(() => null);
      return { id: exam.id, examId: onchainId, onchainId, txHash: r.txHash, windowReopened: r.windowReopened ?? null };
    } catch (e) {
      await this.db.exam.delete({ where: { id: exam.id } }).catch(() => undefined);
      throw e;
    }
  }

  async setCentre(s: Session, examId: string, b: SetCentreBody) {
    const exam = await this.examOr404(examId);
    if (exam.boardAddr !== s.evm) throw new ApiError('FORBIDDEN');
    const centreId = b.centreId.toLowerCase();
    if (await this.db.centre.findUnique({ where: { examId_onchainId: { examId: exam.id, onchainId: centreId } } })) throw new ApiError('CONFLICT');
    const cipher = decodeBlob(b.cipherBlob, 'cipherBlob', 4 * 1024 * 1024);
    const cipherHash = sha3Hex(cipher);
    const shares = b.shares.map((x, i) => decodeBlob(x, `shares.${i}`));
    const centre = await this.db.$transaction(async (tx) => {
      const c = await tx.centre.create({ data: { examId: exam.id, onchainId: centreId, name: b.name, commitment: b.commitment.toLowerCase(), cipherBlob: cipher, cipherHash } });
      await tx.shareBlob.createMany({
        data: shares.map((sh, i) => ({ examId: exam.onchainId, centreId, examinerAddr: exam.examiners[i], examinerIndex: i, sealedToExaminer: sh })),
      });
      return c;
    });
    try {
      const r = await this.relayer.relay(Action.SetCentre, s.evm, { examId: exam.onchainId as Hex, centreId: centreId as Hex, commitment: b.commitment as Hex, cipherHash }, b.signature as Hex);
      await this.db.centre.update({ where: { id: centre.id }, data: { setTx: r.txHash } });
      await this.indexer.catchUp(true).catch(() => null);
      return { centreId, txHash: r.txHash, cipherHash, windowReopened: r.windowReopened ?? null };
    } catch (e) {
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
