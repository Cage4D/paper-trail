/**
 * Release & sitting (spec §7.3, decision D4). Each releasing examiner seals their share of K_c
 * to the centre's CURRENT invigilators (the exam board's epoch group) and signs
 * PaperTrail.release. The API checks the blob's recipients against that epoch's members before
 * relaying, and serves released blobs ONLY after the on-chain `Released` event is indexed.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Hex } from 'viem';
import { Action, centreGroupKey, groupChainId, sealedToExactly } from '@paper-trail/core';
import type { ReleaseBody } from '@paper-trail/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { RelayerService } from '../relayer/relayer.service.js';
import { IndexerService } from '../chain/indexer.service.js';
import { MemberKeysService } from '../groups/members.js';
import { ApiError } from '../common/api-error.js';
import { decodeBlob, sha3Hex, toB64url } from '../common/bytes.js';
import type { Session } from '../auth/session.js';

@Injectable()
export class ReleaseService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(RelayerService) private readonly relayer: RelayerService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
    @Inject(MemberKeysService) private readonly keys: MemberKeysService,
  ) {}

  private async load(examId: string, centreId: string) {
    const exam = /^0x[0-9a-fA-F]{64}$/.test(examId) ? await this.db.exam.findUnique({ where: { onchainId: examId.toLowerCase() } }) : null;
    if (!exam) throw new ApiError('NOT_FOUND');
    const centre = await this.db.centre.findUnique({ where: { examId_onchainId: { examId: exam.id, onchainId: centreId.toLowerCase() } } });
    if (!centre) throw new ApiError('NOT_FOUND');
    return { exam, centre };
  }

  async myShare(s: Session, examId: string, centreId: string) {
    const { exam, centre } = await this.load(examId, centreId);
    const i = exam.examiners.indexOf(s.evm);
    if (i < 0) throw new ApiError('NOT_EXAMINER');
    const sb = await this.db.shareBlob.findUnique({ where: { examId_centreId_examinerAddr: { examId: exam.onchainId, centreId: centre.onchainId, examinerAddr: s.evm } } });
    if (!sb) throw new ApiError('NOT_FOUND');
    return { examinerIndex: sb.examinerIndex, sealedToExaminer: toB64url(sb.sealedToExaminer), released: !!sb.releasedBlob };
  }

  /** The centre's current invigilators and epoch (what a releasing examiner seals to). */
  async invigilators(examId: string, centreId: string) {
    const { exam, centre } = await this.load(examId, centreId);
    const groupKey = centreGroupKey(centre.onchainId);
    const epoch = await this.chain.centreEpoch(exam.boardAddr as Hex, groupChainId(groupKey) as Hex);
    const members = await this.keys.resolve(await this.keys.active(exam.boardAddr, groupKey));
    return {
      groupKey,
      board: exam.boardAddr,
      epoch,
      members: members.map((m) => ({ address: m.address, roleAddress: m.roleAddress, mlkemPublicKey: toB64url(m.mlkemPublicKey), x25519PublicKey: m.x25519PublicKey })),
    };
  }

  async release(s: Session, examId: string, centreId: string, b: ReleaseBody) {
    const { exam, centre } = await this.load(examId, centreId);
    if (!exam.examiners.includes(s.evm)) throw new ApiError('NOT_EXAMINER');
    const sb = await this.db.shareBlob.findUnique({ where: { examId_centreId_examinerAddr: { examId: exam.onchainId, centreId: centre.onchainId, examinerAddr: s.evm } } });
    if (sb?.releaseTx) throw new ApiError('ALREADY_RELEASED');
    const blob = decodeBlob(b.releasedBlob, 'releasedBlob');
    if (sha3Hex(blob) !== b.blobHash.toLowerCase()) throw new ApiError('VALIDATION_FAILED', { fields: 'blobHash' });
    const groupKey = centreGroupKey(centre.onchainId);
    const epoch = await this.chain.centreEpoch(exam.boardAddr as Hex, groupChainId(groupKey) as Hex);
    if (epoch === 0) throw new ApiError('ACTION_REJECTED', { reason: "this centre has no invigilator group yet" });
    if (b.epoch !== epoch) throw new ApiError('VALIDATION_FAILED', { fields: `epoch (current is ${epoch})` });
    const members = await this.keys.resolve(await this.keys.active(exam.boardAddr, groupKey));
    if (!sealedToExactly(blob, members.map((m) => m.mlkemPublicKey))) throw new ApiError('VALIDATION_FAILED', { fields: "releasedBlob (not sealed to exactly the centre's current invigilators)" });

    const r = await this.relayer.relay(Action.Release, s.evm, { examId: exam.onchainId as Hex, centreId: centre.onchainId as Hex, blobHash: b.blobHash as Hex, examiner: s.evm }, b.signature as Hex);
    await this.db.shareBlob.update({ where: { id: sb!.id }, data: { releasedBlob: blob, releasedEpoch: epoch, releaseTx: r.txHash } });
    await this.indexer.catchUp(true).catch(() => null);
    const fresh = await this.db.centre.findUnique({ where: { id: centre.id } });
    const count = await this.db.shareBlob.count({ where: { examId: exam.onchainId, centreId: centre.onchainId, releaseTx: { not: null } } });
    return { count, released: !!fresh?.released, txHash: r.txHash };
  }

  /** Released blobs, ONLY once the Released event is indexed (else 409 NOT_RELEASED). */
  async released(examId: string, centreId: string) {
    await this.indexer.catchUp().catch(() => null);
    const { exam, centre } = await this.load(examId, centreId);
    const rows = await this.db.shareBlob.findMany({ where: { examId: exam.onchainId, centreId: centre.onchainId, releasedBlob: { not: null }, releaseTx: { not: null } } });
    if (!centre.released) throw new ApiError('NOT_RELEASED', { count: rows.length });
    return {
      released: rows.slice(0, 2).map((r) => ({ examiner: r.examinerAddr, epoch: r.releasedEpoch, blob: toB64url(r.releasedBlob!), txHash: r.releaseTx })),
      cipherBlob: toB64url(centre.cipherBlob),
      commitment: centre.commitment,
    };
  }
}
