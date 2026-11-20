import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { ApiError } from '../common/api-error.js';

export interface MemberKeys {
  address: string; // 0x lower
  roleAddress: string; // qor1
  mlkemPublicKey: Uint8Array; // registered on chain
  x25519PublicKey?: string; // hex, from the signed recipient card
}

/** Resolve members to their on-chain ML-KEM keys and recipient-card X25519 keys. */
@Injectable()
export class MemberKeysService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
  ) {}

  async resolve(addresses: string[]): Promise<MemberKeys[]> {
    const users = await this.db.user.findMany({ where: { evmAddress: { in: addresses.map((a) => a.toLowerCase()) } } });
    return Promise.all(
      addresses.map(async (a) => {
        const u = users.find((x) => x.evmAddress === a.toLowerCase());
        if (!u || !u.sealCard) throw new ApiError('KEY_NOT_REGISTERED'); // member must have signed in and published a card
        const kem = await this.chain.kemKey(u.roleAddress);
        if (!kem) throw new ApiError('KEY_NOT_REGISTERED');
        return { address: u.evmAddress, roleAddress: u.roleAddress, mlkemPublicKey: kem, x25519PublicKey: (u.sealCard as { x25519PublicKey?: string }).x25519PublicKey };
      }),
    );
  }

  async active(boardAddr: string, groupKey: string): Promise<string[]> {
    const m = await this.db.member.findMany({ where: { boardAddr, groupKey, active: true }, orderBy: { addedEpoch: 'asc' } });
    return m.map((x) => x.address);
  }
}
