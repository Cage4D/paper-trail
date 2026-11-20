/**
 * QoreX ↔ role-key binding (decision D2, built in Phase 5).
 *  1. POST /me/bind/challenge gives a nonce and memo.
 *  2. The user's QoreX wallet sends ITSELF a tiny amount with that memo (QoreX
 *     `signAndBroadcast`): a real QoreChain tx, signed by the QoreX account and verified by the
 *     chain.
 *  3. POST /me/bind with that tx hash and the ROLE key's ML-DSA-87 signature over
 *     bindIdentity(role, SHA3-256(bindingStatement)). The API checks the tx (success, memo =
 *     our nonce, a MsgSend from and to the claimed QoreX address), rebuilds the statement,
 *     and relays bindIdentity. The binding is recorded on chain (IdentityBound) and in the DB.
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Hex } from 'viem';
import { Action, BINDING_MEMO_PREFIX, bindingMemo, bindingStatement, statementHash } from '@paper-trail/core';
import type { BindBody } from '@paper-trail/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { RelayerService } from '../relayer/relayer.service.js';
import { ApiError } from '../common/api-error.js';
import type { Session } from './session.js';

const TTL_MS = 30 * 60_000;

@Injectable()
export class BindingService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(RelayerService) private readonly relayer: RelayerService,
  ) {}

  async challenge(s: Session) {
    const nonce = randomBytes(12).toString('hex');
    await this.db.bindChallenge.create({ data: { nonce, userId: s.userId, expiresAt: new Date(Date.now() + TTL_MS) } });
    return { nonce, memo: bindingMemo(nonce), instructions: 'Send yourself 1 uqor from your QoreX wallet with exactly this memo, then submit the tx hash.' };
  }

  async bind(s: Session, b: BindBody) {
    const tx = await this.chain.nativeTx(b.txHash);
    if (!tx) throw new ApiError('NOT_FOUND');
    if (tx.code !== 0) throw new ApiError('ACTION_REJECTED', { reason: 'the binding transaction failed' });
    if (!tx.memo.startsWith(BINDING_MEMO_PREFIX)) throw new ApiError('VALIDATION_FAILED', { fields: 'txHash (memo)' });
    const nonce = tx.memo.slice(BINDING_MEMO_PREFIX.length);
    const ch = await this.db.bindChallenge.findUnique({ where: { nonce } });
    if (!ch || ch.userId !== s.userId || ch.usedAt || ch.expiresAt < new Date()) throw new ApiError('UNAUTHENTICATED');
    const send = tx.messages.find((m) => m['@type'] === '/cosmos.bank.v1beta1.MsgSend') as { from_address?: string; to_address?: string } | undefined;
    if (!send || send.from_address !== b.qorexAddress || send.to_address !== b.qorexAddress) throw new ApiError('VALIDATION_FAILED', { fields: 'txHash (must be a self-transfer from the QoreX address)' });
    const taken = await this.db.user.findUnique({ where: { qorexAddress: b.qorexAddress } });
    if (taken && taken.id !== s.userId) throw new ApiError('CONFLICT');

    const statement = bindingStatement({ roleAddress: s.roleAddress, qorexAddress: b.qorexAddress, nonce, txHash: b.txHash });
    const sh = statementHash(statement);
    const r = await this.relayer.relay(Action.BindIdentity, s.evm, { role: s.evm, statementHash: sh }, b.signature as Hex);
    await this.db.$transaction([
      this.db.bindChallenge.update({ where: { nonce }, data: { usedAt: new Date() } }),
      this.db.user.update({ where: { id: s.userId }, data: { qorexAddress: b.qorexAddress, bindTx: b.txHash.toUpperCase(), bindStatementHash: sh, bindRelayTx: r.txHash } }),
    ]);
    return { qorexAddress: b.qorexAddress, statement, statementHash: sh, relayTx: r.txHash };
  }
}
