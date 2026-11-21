/**
 * Sign In With QoreChain, signed by the user's Paper Trail ROLE key (decision D2: QoreX 0.3.x
 * cannot sign messages for third-party sites, findings Q2).
 * The signature is hybrid: ADR-36 secp256k1 + ML-DSA-87 over "qorechain-siwq-v1|" + message.
 * The ML-DSA part is checked against the key REGISTERED ON CHAIN for the address, read with the
 * pqcKeyStatus precompile, so an unregistered key cannot sign in.
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Hex } from 'viem';
import { parseAddress, parseSiwqMessage } from '@qorechain/qoresign';
import { checkRecipientCard, createSignIn, fromHex, verifySignIn, type SiwqSignature } from '@paper-trail/core';
import type { RecipientCard } from '@qorechain/qoreseal';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { ApiError } from '../common/api-error.js';
import { config } from '../config.js';
import type { Session } from './session.js';

const CHALLENGE_TTL_MS = 10 * 60_000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
  ) {}

  async challenge(address: string): Promise<{ message: string; nonce: string }> {
    const nonce = randomBytes(12).toString('hex'); // ≥ 8 alphanumerics
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    const message = createSignIn({ domain: config().APP_DOMAIN, uri: config().APP_URI, address, nonce, expirationTime: expiresAt.toISOString() });
    await this.db.authChallenge.create({ data: { nonce, address, message, expiresAt } });
    return { message, nonce };
  }

  async verify(message: string, signature: SiwqSignature): Promise<Session> {
    let fields;
    try {
      fields = parseSiwqMessage(message);
    } catch {
      throw new ApiError('VALIDATION_FAILED', { fields: 'message' });
    }
    const ch = await this.db.authChallenge.findUnique({ where: { nonce: fields.nonce } });
    if (!ch || ch.usedAt || ch.expiresAt < new Date() || ch.address !== fields.address || ch.message !== message) throw new ApiError('UNAUTHENTICATED');
    const evm = parseAddress(fields.address).hex.toLowerCase() as Hex;
    const key = await this.chain.pqcKeyStatus(evm);
    if (!key.registered || key.algorithmId !== 1) throw new ApiError('KEY_NOT_REGISTERED');
    try {
      verifySignIn({ message, signature, domain: config().APP_DOMAIN, nonce: fields.nonce, pqPublicKey: fromHex(key.pubkey) });
    } catch {
      throw new ApiError('BAD_SIGNATURE');
    }
    // single use
    const used = await this.db.authChallenge.updateMany({ where: { nonce: fields.nonce, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) throw new ApiError('UNAUTHENTICATED');
    const user = await this.db.user.upsert({ where: { roleAddress: fields.address }, create: { roleAddress: fields.address, evmAddress: evm }, update: {} });
    return { userId: user.id, roleAddress: user.roleAddress, evm };
  }

  /** Store the user's QoreSeal recipient card after checking it against both keys on chain. */
  async setCard(s: Session, card: Record<string, unknown>) {
    const key = await this.chain.pqcKeyStatus(s.evm);
    if (!key.registered) throw new ApiError('KEY_NOT_REGISTERED');
    const kem = await this.chain.kemKey(s.roleAddress);
    if (!kem) throw new ApiError('KEY_NOT_REGISTERED');
    try {
      checkRecipientCard(card as unknown as RecipientCard, { pqPublicKey: fromHex(key.pubkey), mlkemPublicKey: kem, address: s.roleAddress });
    } catch {
      throw new ApiError('BAD_SIGNATURE');
    }
    await this.db.user.update({ where: { id: s.userId }, data: { sealCard: card as object } });
    return { registered: { pqc: true, kem: true }, card: true };
  }

  async status(s: Session) {
    const key = await this.chain.pqcKeyStatus(s.evm);
    const kem = await this.chain.kemKey(s.roleAddress);
    const user = await this.db.user.findUnique({ where: { id: s.userId } });
    const balance = await this.chain.client.getBalance({ address: s.evm });
    return {
      roleAddress: s.roleAddress,
      evmAddress: s.evm,
      pqc: { registered: key.registered, algorithmId: key.algorithmId },
      kem: { registered: !!kem },
      recipientCard: !!user?.sealCard,
      ...(balance === 0n ? { faucetHint: 'Fund this address with testnet QOR first: https://dashboard.qorechain.io/faucet' } : {}),
    };
  }

  async directory(role?: string) {
    if (role !== undefined && !['invigilator', 'marker'].includes(role.toLowerCase())) throw new ApiError('VALIDATION_FAILED', { fields: 'role (invigilator or marker)' });
    const users = (await this.db.user.findMany({ orderBy: { createdAt: 'asc' } })).filter((u) => u.sealCard !== null);
    const roles = role ? new Set((await this.db.member.findMany({ where: { role: role.toUpperCase() as never, active: true } })).map((m) => m.address)) : null;
    return users
      .filter((u) => !roles || roles.has(u.evmAddress))
      .map((u) => ({ roleAddress: u.roleAddress, evmAddress: u.evmAddress, sealCard: u.sealCard }));
  }
}
