/**
 * Centre / marker epoch groups (spec §7.3 Groups). The board's client runs QoreSeal's
 * EpochKeyManager (@paper-trail/core BoardGroups) and sends: the new epoch's envelope, the
 * members hash, its sealed board state, and its ML-DSA-87 signature over rotateEpoch.
 *
 * Before relaying, the API checks that:
 *  - epoch = on-chain centreEpoch(board, groupChainId) + 1;
 *  - membersHash matches the new member list;
 *  - the envelope is sealed to EXACTLY those members (QoreSeal recipient hints against their
 *    on-chain ML-KEM keys).
 * So a client cannot record one member list on chain and seal the key to another.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Hex } from 'viem';
import { Action, groupChainId, membersHash, sealedToExactly } from '@paper-trail/core';
import type { RemoveMemberBody, RotateBody } from '@paper-trail/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { RelayerService } from '../relayer/relayer.service.js';
import { IndexerService } from '../chain/indexer.service.js';
import { ApiError } from '../common/api-error.js';
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
    @Inject(IndexerService) private readonly indexer: IndexerService,
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
    const current = await this.keys.active(s.evm, k);
    const added = b.addresses.map((a) => a.toLowerCase()).filter((a) => !current.includes(a));
    return this.rotate(s, k, [...current, ...added], b, { added, role: b.role === 'marker' ? 'MARKER' : 'INVIGILATOR' });
  }

  async remove(s: Session, groupKey: string, address: string, b: RemoveMemberBody) {
    const k = await this.checkKey(s, groupKey);
    const current = await this.keys.active(s.evm, k);
    const a = address.toLowerCase();
    if (!current.includes(a)) throw new ApiError('NOT_FOUND');
    return this.rotate(s, k, current.filter((x) => x !== a), b, { removed: a });
  }

  private async rotate(
    s: Session,
    groupKey: string,
    members: string[],
    b: RemoveMemberBody,
    change: { added?: string[]; removed?: string; role?: 'INVIGILATOR' | 'MARKER' },
  ) {
    if (!members.length) throw new ApiError('VALIDATION_FAILED', { fields: 'members (a group needs at least one member)' });
    const chainId = groupChainId(groupKey) as Hex;
    const onchain = await this.chain.centreEpoch(s.evm, chainId);
    if (b.epoch !== onchain + 1) throw new ApiError('VALIDATION_FAILED', { fields: `epoch (expected ${onchain + 1})` });
    if (b.membersHash.toLowerCase() !== membersHash(members)) throw new ApiError('VALIDATION_FAILED', { fields: 'membersHash' });
    const envelope = decodeBlob(b.envelope, 'envelope');
    const keys = await this.keys.resolve(members);
    if (!sealedToExactly(envelope, keys.map((x) => x.mlkemPublicKey))) throw new ApiError('VALIDATION_FAILED', { fields: 'envelope (not sealed to exactly the members)' });
    const state = decodeBlob(b.sealedBoardState, 'sealedBoardState', 2 * 1024 * 1024);
    const envelopeHash = sha3Hex(envelope);

    const r = await this.relayer.relay(Action.RotateEpoch, s.evm, { centreId: chainId, board: s.evm, epoch: BigInt(b.epoch), membersHash: b.membersHash as Hex, envelopeHash }, b.signature as Hex);

    const role = change.role ?? (await this.db.member.findFirst({ where: { boardAddr: s.evm, groupKey } }))?.role ?? 'INVIGILATOR';
    await this.db.$transaction([
      this.db.epochEnvelope.create({ data: { boardAddr: s.evm, groupKey, epoch: b.epoch, envelope, membersHash: b.membersHash.toLowerCase(), txHash: r.txHash } }),
      ...(change.added ?? []).map((address) => this.db.member.create({ data: { boardAddr: s.evm, groupKey, role, address, addedEpoch: b.epoch } })),
      ...(change.removed ? [this.db.member.updateMany({ where: { boardAddr: s.evm, groupKey, address: change.removed, active: true }, data: { active: false, removedEpoch: b.epoch } })] : []),
      this.db.boardState.upsert({ where: { boardAddr: s.evm }, create: { boardAddr: s.evm, sealedState: state }, update: { sealedState: state } }),
    ]);
    await this.indexer.catchUp(true).catch(() => null);
    return { groupKey, epoch: b.epoch, members, envelopeHash, txHash: r.txHash };
  }

  /** Envelopes since an epoch: clients open the ones they can. */
  async epochs(groupKey: string, board: string | undefined, since: number) {
    const k = groupKey.toLowerCase();
    if (!GROUP_KEY.test(k)) throw new ApiError('VALIDATION_FAILED', { fields: 'groupKey' });
    const where = { groupKey: k, epoch: { gt: since }, ...(board ? { boardAddr: board.toLowerCase() } : {}) };
    const rows = await this.db.epochEnvelope.findMany({ where, orderBy: [{ boardAddr: 'asc' }, { epoch: 'asc' }] });
    const boards = new Set(rows.map((r) => r.boardAddr));
    if (!board && boards.size > 1) throw new ApiError('VALIDATION_FAILED', { fields: 'board (several boards use this group key)' });
    return rows.map((r) => ({ board: r.boardAddr, epoch: r.epoch, envelope: toB64url(r.envelope), membersHash: r.membersHash, txHash: r.txHash }));
  }

  async members(groupKey: string, board: string) {
    return this.keys.active(board.toLowerCase(), groupKey.toLowerCase());
  }

  async boardState(s: Session) {
    const st = await this.db.boardState.findUnique({ where: { boardAddr: s.evm } });
    if (!st) throw new ApiError('NOT_FOUND');
    return { sealedState: toB64url(st.sealedState), updatedAt: st.updatedAt.toISOString() };
  }
}
