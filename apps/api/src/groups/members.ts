/**
 * Group membership as the CHAIN sees it (bug-hunt findings 2/3): the current members are the
 * member list of the epoch PaperTrail is at for (board, group), taken from that epoch's
 * EpochEnvelope row, which counts only once the indexed EpochChanged confirmed its membersHash.
 * A rotation that is still pending (or failed) never changes who you seal to.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Hex } from 'viem';
import { groupChainId, membersHash } from '@paper-trail/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { IndexerService } from '../chain/indexer.service.js';
import { ApiError } from '../common/api-error.js';

export interface MemberKeys {
  address: string; // 0x lower
  roleAddress: string; // qor1
  mlkemPublicKey: Uint8Array; // registered on chain
  x25519PublicKey?: string; // hex, from the signed recipient card
  card: unknown; // the signed QoreSeal recipient card (clients verify it themselves)
}

export interface GroupState {
  groupKey: string;
  groupChainId: string;
  board: string;
  epoch: number;
  members: string[];
  membersHash: string | null;
  /** tx of the EpochChanged event for `epoch` (clients fetch its receipt from the chain to verify) */
  epochTx: string | null;
}

@Injectable()
export class MemberKeysService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
  ) {}

  /** Members of the epoch the chain is at. Throws RELAYER_BUSY if that epoch is not confirmed yet. */
  async current(board: string, groupKey: string): Promise<GroupState> {
    const gid = groupChainId(groupKey);
    const epoch = await this.chain.centreEpoch(board as Hex, gid as Hex);
    const base = { groupKey, groupChainId: gid, board, epoch };
    if (!epoch) return { ...base, members: [], membersHash: null, epochTx: null };
    let env = await this.db.epochEnvelope.findUnique({ where: { boardAddr_groupKey_epoch: { boardAddr: board, groupKey, epoch } } });
    if (env && !env.confirmed) {
      await this.indexer.catchUp(true).catch(() => null);
      env = await this.db.epochEnvelope.findUnique({ where: { boardAddr_groupKey_epoch: { boardAddr: board, groupKey, epoch } } });
    }
    if (!env || !env.confirmed) throw new ApiError('RELAYER_BUSY'); // the chain moved but we have not confirmed that epoch yet
    if (membersHash(env.members) !== env.membersHash) throw new ApiError('RELAYER_BUSY');
    return { ...base, members: env.members, membersHash: env.membersHash, epochTx: env.txHash };
  }

  async resolve(addresses: string[]): Promise<MemberKeys[]> {
    const users = await this.db.user.findMany({ where: { evmAddress: { in: addresses.map((a) => a.toLowerCase()) } } });
    return Promise.all(
      addresses.map(async (a) => {
        const u = users.find((x) => x.evmAddress === a.toLowerCase());
        if (!u || !u.sealCard) throw new ApiError('KEY_NOT_REGISTERED'); // member must have signed in and published a card
        const kem = await this.chain.kemKey(u.roleAddress);
        if (!kem) throw new ApiError('KEY_NOT_REGISTERED');
        return { address: u.evmAddress, roleAddress: u.roleAddress, mlkemPublicKey: kem, x25519PublicKey: (u.sealCard as { x25519PublicKey?: string }).x25519PublicKey, card: u.sealCard };
      }),
    );
  }

  /** Public view of a group for sealing: epoch, membersHash and every member's signed card. */
  async publicState(board: string, groupKey: string) {
    const g = await this.current(board, groupKey);
    const keys = await this.resolve(g.members);
    return {
      ...g,
      members: keys.map((m) => ({ address: m.address, roleAddress: m.roleAddress, card: m.card })),
      verify:
        'Before sealing, check membersHash against the EpochChanged event on chain and each card against the member\'s on-chain PQC and KEM keys (@paper-trail/core resolveGroupRecipients).',
    };
  }
}
