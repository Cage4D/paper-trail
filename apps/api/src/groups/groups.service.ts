/**
 * Centre / marker epoch groups (spec §7.3 Groups). The board's client runs QoreSeal's
 * EpochKeyManager (@paper-trail/core BoardGroups) and sends the new epoch's envelope, the members
 * hash, its sealed board state and its ML-DSA-87 signature over rotateEpoch.
 *
 * Before relaying, the API checks:
 *  - epoch = on-chain epoch + 1, and no earlier rotation of this group is still pending;
 *  - membersHash matches the new member list (current CONFIRMED members ± change);
 *  - the envelope is sealed to EXACTLY those members (recipient hints vs on-chain ML-KEM keys).
 * The epoch's row is written BEFORE relaying and confirmed by the indexed EpochChanged event,
 * which also applies the member changes. A timed-out relay therefore never loses or forks
 * membership (bug-hunt finding 2).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Hex } from 'viem';
import { Action, groupChainId, membersHash, sealedToExactly } from '@paper-trail/core';
import type { RemoveMemberBody, RotateBody } from '@paper-trail/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { RelayerService } from '../relayer/relayer.service.js';
import { ApiError, maybeSent } from '../common/api-error.js';
import { decodeBlob, sha3Hex, toB64url } from '../common/bytes.js';
import type { Session } from '../auth/session.js';
import { MemberKeysService } from './members.js';

const GROUP_KEY = /^(centre|markers):0x[0-9a-f]{64}$/;

@Injectable()
export class GroupsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(RelayerService) private readonly relayer: RelayerService,
    @Inject(MemberKeysService) private readonly keys: MemberKeysService,
  ) {}

  private async checkKey(s: Session, groupKey: string) {
    const k = groupKey.toLowerCase();
    if (!GROUP_KEY.test(k)) throw new ApiError('VALIDATION_FAILED', { fields: 'groupKey' });
    if (k.startsWith('markers:')) {
      const exam = await this.db.exam.findUnique({ where: { onchainId: k.slice(8) } });
      if (!exam) throw new ApiError('NOT_FOUND');
      if (exam.boardAddr !== s.evm) throw new ApiError('FORBIDDEN');
    }
    return k;
  }

  async add(s: Session, groupKey: string, b: RotateBody) {
    const k = await this.checkKey(s, groupKey);
    const cur = await this.keys.current(s.evm, k);
    const added = b.addresses.map((a) => a.toLowerCase()).filter((a) => !cur.members.includes(a));
    return this.rotate(s, k, cur.epoch, [...cur.members, ...added], b, { added, removed: [], role: b.role === 'marker' ? 'MARKER' : 'INVIGILATOR' });
  }

  async remove(s: Session, groupKey: string, address: string, b: RemoveMemberBody) {
    const k = await this.checkKey(s, groupKey);
    const cur = await this.keys.current(s.evm, k);
    const a = address.toLowerCase();
    if (!cur.members.includes(a)) throw new ApiError('NOT_FOUND');
    const prev = await this.db.epochEnvelope.findUnique({ where: { boardAddr_groupKey_epoch: { boardAddr: s.evm, groupKey: k, epoch: cur.epoch } } });
    return this.rotate(s, k, cur.epoch, cur.members.filter((x) => x !== a), b, { added: [], removed: [a], role: prev?.role ?? 'INVIGILATOR' });
  }

  private async rotate(
    s: Session,
    groupKey: string,
    onchainEpoch: number,
    members: string[],
    b: RemoveMemberBody,
    change: { added: string[]; removed: string[]; role: 'INVIGILATOR' | 'MARKER' },
  ) {
    if (!members.length) throw new ApiError('VALIDATION_FAILED', { fields: 'members (a group needs at least one member)' });
    if (b.epoch !== onchainEpoch + 1) throw new ApiError('VALIDATION_FAILED', { fields: `epoch (expected ${onchainEpoch + 1})` });
    if (b.membersHash.toLowerCase() !== membersHash(members)) throw new ApiError('VALIDATION_FAILED', { fields: 'membersHash' });
    const envelope = decodeBlob(b.envelope, 'envelope');
    const keys = await this.keys.resolve(members);
    if (!sealedToExactly(envelope, keys.map((x) => x.mlkemPublicKey))) throw new ApiError('VALIDATION_FAILED', { fields: 'envelope (not sealed to exactly the members)' });
    const state = decodeBlob(b.sealedBoardState, 'sealedBoardState', 2 * 1024 * 1024);
    const gid = groupChainId(groupKey);
    const ref = `group:${s.evm}:${groupKey}:${b.epoch}`;

    // an earlier attempt at this epoch: pending → wait; failed → replace
    const existing = await this.db.epochEnvelope.findUnique({ where: { boardAddr_groupKey_epoch: { boardAddr: s.evm, groupKey, epoch: b.epoch } } });
    if (existing) {
      if (existing.confirmed) throw new ApiError('CONFLICT');
      const job = await this.relayer.jobFor(ref);
      if (job && job.status !== 'FAILED') throw ApiError.pending(job.txHash ?? '');
      await this.db.epochEnvelope.delete({ where: { id: existing.id } });
    }
    const row = await this.db.epochEnvelope.create({
      data: { boardAddr: s.evm, groupKey, groupChainId: gid, epoch: b.epoch, envelope, membersHash: b.membersHash.toLowerCase(), members, added: change.added, removed: change.removed, role: change.role },
    });
    try {
      const r = await this.relayer.relay(Action.RotateEpoch, s.evm, { centreId: gid as Hex, board: s.evm, epoch: BigInt(b.epoch), membersHash: b.membersHash as Hex, envelopeHash: sha3Hex(envelope) }, b.signature as Hex, { ref });
      await this.db.boardState.upsert({ where: { boardAddr: s.evm }, create: { boardAddr: s.evm, sealedState: state }, update: { sealedState: state } });
      return { groupKey, epoch: b.epoch, members, envelopeHash: sha3Hex(envelope), txHash: r.txHash };
    } catch (e) {
      if (maybeSent(e)) {
        await this.db.boardState.upsert({ where: { boardAddr: s.evm }, create: { boardAddr: s.evm, sealedState: state }, update: { sealedState: state } });
      } else {
        await this.db.epochEnvelope.delete({ where: { id: row.id } }).catch(() => undefined);
      }
      throw e;
    }
  }

  /** Envelopes since an epoch (confirmed ones only): clients open the ones they can. */
  async epochs(groupKey: string, board: string | undefined, since: number) {
    const k = groupKey.toLowerCase();
    if (!GROUP_KEY.test(k)) throw new ApiError('VALIDATION_FAILED', { fields: 'groupKey' });
    const where = { groupKey: k, confirmed: true, epoch: { gt: since }, ...(board ? { boardAddr: board.toLowerCase() } : {}) };
    const rows = await this.db.epochEnvelope.findMany({ where, orderBy: [{ boardAddr: 'asc' }, { epoch: 'asc' }] });
    const boards = new Set(rows.map((r) => r.boardAddr));
    if (!board && boards.size > 1) throw new ApiError('VALIDATION_FAILED', { fields: 'board (several boards use this group key)' });
    return rows.map((r) => ({ board: r.boardAddr, epoch: r.epoch, envelope: toB64url(r.envelope), membersHash: r.membersHash, members: r.members, txHash: r.txHash }));
  }

  async boardState(s: Session) {
    const st = await this.db.boardState.findUnique({ where: { boardAddr: s.evm } });
    if (!st) throw new ApiError('NOT_FOUND');
    return { sealedState: toB64url(st.sealedState), updatedAt: st.updatedAt.toISOString() };
  }
}
