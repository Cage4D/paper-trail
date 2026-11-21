/**
 * Release & sitting (spec §7.3, decision D4). Each releasing examiner seals their share of K_c to
 * the centre's CURRENT invigilators (the exam board's epoch group, as the chain sees it) and
 * signs PaperTrail.release including that epoch (bug-hunt finding 1: the contract refuses it
 * unless still current). The API checks the blob's recipients against that epoch's confirmed
 * members, stores the blob BEFORE relaying (so a timed-out relay never loses it), and serves
 * released blobs ONLY after the on-chain `Released` event is indexed.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Hex } from 'viem';
import { Action, centreGroupKey, sealedToExactly } from '@paper-trail/core';
import type { ReleaseBody } from '@paper-trail/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { RelayerService } from '../relayer/relayer.service.js';
import { IndexerService } from '../chain/indexer.service.js';
import { MemberKeysService } from '../groups/members.js';
import { ApiError, maybeSent } from '../common/api-error.js';
import { decodeBlob, sha3Hex, toB64url } from '../common/bytes.js';
import type { Session } from '../auth/session.js';

@Injectable()
export class ReleaseService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(RelayerService) private readonly relayer: RelayerService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
    @Inject(MemberKeysService) private readonly keys: MemberKeysService,
  ) {}

  private async load(examId: string, centreId: string) {
    const exam = /^0x[0-9a-fA-F]{64}$/.test(examId) ? await this.db.exam.findUnique({ where: { onchainId: examId.toLowerCase() } }) : null;
    if (!exam) throw new ApiError('NOT_FOUND');
    const centre = /^0x[0-9a-fA-F]{64}$/.test(centreId) ? await this.db.centre.findUnique({ where: { examId_onchainId: { examId: exam.id, onchainId: centreId.toLowerCase() } } }) : null;
    if (!centre) throw new ApiError('NOT_FOUND');
    return { exam, centre };
  }

  async myShare(s: Session, examId: string, centreId: string) {
    const { exam, centre } = await this.load(examId, centreId);
    if (!exam.examiners.includes(s.evm)) throw new ApiError('NOT_EXAMINER');
    const sb = await this.db.shareBlob.findUnique({ where: { examId_centreId_examinerAddr: { examId: exam.onchainId, centreId: centre.onchainId, examinerAddr: s.evm } } });
    if (!sb) throw new ApiError('NOT_FOUND');
    return { examinerIndex: sb.examinerIndex, sealedToExaminer: toB64url(sb.sealedToExaminer), released: !!sb.releaseTx };
  }

  /** The centre's current invigilators: epoch, on-chain membersHash and each member's signed card (finding 3). */
  async invigilators(examId: string, centreId: string) {
    const { exam, centre } = await this.load(examId, centreId);
    return this.keys.publicState(exam.boardAddr, centreGroupKey(centre.onchainId));
  }

  async release(s: Session, examId: string, centreId: string, b: ReleaseBody) {
    const { exam, centre } = await this.load(examId, centreId);
    if (!exam.examiners.includes(s.evm)) throw new ApiError('NOT_EXAMINER');
    const sb = await this.db.shareBlob.findUnique({ where: { examId_centreId_examinerAddr: { examId: exam.onchainId, centreId: centre.onchainId, examinerAddr: s.evm } } });
    if (!sb) throw new ApiError('NOT_FOUND');
    if (sb.releaseTx) throw new ApiError('ALREADY_RELEASED');
    const ref = `release:${exam.onchainId}:${centre.onchainId}:${s.evm}`;
    const prior = await this.relayer.jobFor(ref);
    if (prior && (prior.status === 'SUBMITTED' || prior.status === 'QUEUED')) throw ApiError.pending(prior.txHash ?? '');
    const blob = decodeBlob(b.releasedBlob, 'releasedBlob');
    if (sha3Hex(blob) !== b.blobHash.toLowerCase()) throw new ApiError('VALIDATION_FAILED', { fields: 'blobHash' });
    const g = await this.keys.current(exam.boardAddr, centreGroupKey(centre.onchainId));
    if (g.epoch === 0) throw new ApiError('ACTION_REJECTED', { reason: 'this centre has no invigilator group yet' });
    if (b.epoch !== g.epoch) throw new ApiError('VALIDATION_FAILED', { fields: `epoch (current is ${g.epoch})` });
    const members = await this.keys.resolve(g.members);
    if (!sealedToExactly(blob, members.map((m) => m.mlkemPublicKey))) throw new ApiError('VALIDATION_FAILED', { fields: "releasedBlob (not sealed to exactly the centre's current invigilators)" });

    // keep the blob BEFORE relaying: a relay that times out may still land, and the blob must not be lost
    await this.db.shareBlob.update({ where: { id: sb.id }, data: { releasedBlob: blob } });
    try {
      const r = await this.relayer.relay(
        Action.Release, s.evm,
        { examId: exam.onchainId as Hex, centreId: centre.onchainId as Hex, blobHash: b.blobHash as Hex, examiner: s.evm, epoch: BigInt(b.epoch) },
        b.signature as Hex, { ref, examId: exam.onchainId },
      );
      // releasedEpoch / releaseTx come from the indexed ShareReleased event (chain truth)
      const fresh = await this.db.centre.findUnique({ where: { id: centre.id } });
      const count = await this.db.shareBlob.count({ where: { examId: exam.onchainId, centreId: centre.onchainId, releaseTx: { not: null } } });
      return { count, released: !!fresh?.released, txHash: r.txHash };
    } catch (e) {
      if (!maybeSent(e)) await this.db.shareBlob.update({ where: { id: sb.id }, data: { releasedBlob: null } }).catch(() => undefined);
      throw e;
    }
  }

  /** Released blobs, ONLY once the Released event is indexed (else 409 NOT_RELEASED). */
  async released(examId: string, centreId: string) {
    await this.indexer.catchUp().catch(() => null);
    let { exam, centre } = await this.load(examId, centreId);
    if (!centre.released) {
      await this.indexer.catchUp(true).catch(() => null);
      ({ exam, centre } = await this.load(examId, centreId));
    }
    const rows = await this.db.shareBlob.findMany({
      where: { examId: exam.onchainId, centreId: centre.onchainId, releasedBlob: { not: null }, releaseTx: { not: null } },
      orderBy: [{ releasedEpoch: 'asc' }, { examinerIndex: 'asc' }],
    });
    if (!centre.released) throw new ApiError('NOT_RELEASED', { count: rows.length });
    return {
      released: rows.slice(0, 2).map((r) => ({ examiner: r.examinerAddr, epoch: r.releasedEpoch, blob: toB64url(r.releasedBlob!), txHash: r.releaseTx })),
      cipherBlob: toB64url(centre.cipherBlob),
      commitment: centre.commitment,
    };
  }
}
