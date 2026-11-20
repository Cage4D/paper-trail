/**
 * The untrusted relayer (spec §3.1, §7.1). It cannot forge anything: every action carries the
 * role holder's ML-DSA-87 signature, which PaperTrail checks on chain. The relayer just pays gas
 * and holds the EVM window.
 *
 * relay(): (1) the signer must have a registered ML-DSA-87 key (pqcKeyStatus);
 *          (2) under one Postgres advisory lock (serialises ALL sends: per-signer nonce order
 *              and the relayer's own EVM nonce):
 *              a. digest = core.buildAction(...) with the signer's CURRENT on-chain nonce;
 *              b. verify off-chain first: the real pqcVerify precompile via eth_call;
 *              c. lazily reopen the EVM window (narrowed to PaperTrail) when it is low;
 *              d. simulate (contract reverts → catalog codes), send, wait for the receipt.
 *          Transient RPC failures are retried (3 attempts); a window rejection triggers one
 *          reopen + retry. Every attempt is recorded in RelayJob (no blobs, no secrets).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BaseError, ContractFunctionRevertedError, type Hex } from 'viem';
import { classifyEvmWindowRejection } from '@qorechain/evm';
import { Action, buildAction, type ActionFields } from '@paper-trail/core';
import { CONTRACT_ERROR_CODES } from '@paper-trail/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { ApiError } from '../common/api-error.js';
import { config } from '../config.js';

const LOCK_ID = 7_000_001; // pg advisory lock key for relaying
const FUNCTION: Record<Action, string> = {
  [Action.CreateExam]: 'createExam',
  [Action.SetCentre]: 'setCentre',
  [Action.RotateEpoch]: 'rotateEpoch',
  [Action.Release]: 'release',
  [Action.SubmitScript]: 'submitScript',
  [Action.PublishMarks]: 'publishMarks',
  [Action.BindIdentity]: 'bindIdentity',
};

export interface RelayResult {
  jobId: string;
  txHash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  windowReopened?: string;
}

@Injectable()
export class RelayerService {
  private readonly log = new Logger('Relayer');
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
  ) {}

  async relay<A extends Action>(action: A, signer: Hex, fields: ActionFields[A], signature: Hex): Promise<RelayResult> {
    const key = await this.call(() => this.chain.pqcKeyStatus(signer));
    if (!key.registered || key.algorithmId !== 1) throw new ApiError('KEY_NOT_REGISTERED');

    const job = await this.db.relayJob.create({
      data: { action: Action[action], signer: signer.toLowerCase(), payload: jsonable(fields), status: 'QUEUED' },
    });
    try {
      const res = await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_ID})`;
          const nonce = await this.call(() => this.chain.nonceOf(signer));
          const built = buildAction(action, fields, { chainId: config().CHAIN_ID, contract: this.chain.address, signer, nonce });
          // (b) verify off-chain first, with the real precompile
          const ok = await this.call(() => this.chain.pqcVerify(key.pubkey, signature, built.digest));
          if (!ok) throw new ApiError('BAD_SIGNATURE');
          // (c) window
          let windowReopened: string | undefined;
          if (await this.call(() => this.chain.windowNeedsReopen())) {
            windowReopened = await this.chain.openWindow();
            this.log.log(`window reopened tx=${windowReopened}`);
            await this.waitForWindow();
          }
          // (d) simulate, send
          const args = [...built.args, signature];
          const send = async () => {
            const wallet = await this.chain.wallet();
            const { request } = await this.chain.client.simulateContract({
              address: this.chain.address, abi: this.chain.abi, functionName: FUNCTION[action], args, account: wallet.account,
            });
            const hash = await wallet.writeContract(request);
            await tx.relayJob.update({ where: { id: job.id }, data: { status: 'SUBMITTED', txHash: hash, attempts: { increment: 1 } } });
            const receipt = await this.chain.client.waitForTransactionReceipt({ hash, timeout: 90_000 });
            if (receipt.status !== 'success') throw new ApiError('ACTION_REJECTED', { reason: 'the transaction reverted' });
            return { txHash: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
          };
          let out;
          try {
            out = await this.mapReverts(send);
          } catch (e) {
            // a window refusal at send time (e.g. raced expiry): reopen once and retry
            if (classifyEvmWindowRejection(e) && !windowReopened) {
              windowReopened = await this.chain.openWindow();
              await this.waitForWindow();
              out = await this.mapReverts(send);
            } else throw e;
          }
          return { ...out, windowReopened };
        },
        { timeout: 240_000, maxWait: 30_000 },
      );
      await this.db.relayJob.update({ where: { id: job.id }, data: { status: 'CONFIRMED', txHash: res.txHash } });
      this.log.log(`${Action[action]} signer=${signer} tx=${res.txHash} gas=${res.gasUsed}`);
      return { jobId: job.id, ...res };
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('RELAYER_BUSY');
      await this.db.relayJob.update({ where: { id: job.id }, data: { status: 'FAILED', error: err.code } }).catch(() => undefined);
      if (!(e instanceof ApiError)) this.log.error(`${Action[action]} failed: ${e instanceof Error ? e.message.split('\n')[0] : 'unknown'}`);
      throw err;
    }
  }

  /** Contract custom errors → catalog codes; window refusals pass through for the caller. */
  private async mapReverts<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.call(fn);
    } catch (e) {
      if (e instanceof ApiError || classifyEvmWindowRejection(e)) throw e;
      const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
      if (rev instanceof ContractFunctionRevertedError) {
        const name = rev.data?.errorName ?? 'unknown';
        const code = CONTRACT_ERROR_CODES[name];
        if (code === 'TOO_EARLY') throw new ApiError('TOO_EARLY', { startTime: new Date(Number(rev.data?.args?.[0] ?? 0) * 1000).toISOString() });
        if (code) throw new ApiError(code, code === 'NOT_RELEASED' ? { count: 1 } : {});
        throw new ApiError('ACTION_REJECTED', { reason: name });
      }
      throw e;
    }
  }

  /** Retry transient RPC/network failures (not reverts, not API errors). */
  private async call<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (e) {
        const transient = !(e instanceof ApiError) && !(e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError)) && !classifyEvmWindowRejection(e);
        if (!transient || i >= attempts) throw e;
        await new Promise((r) => setTimeout(r, 500 * i));
      }
    }
  }

  private async waitForWindow(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      if (!(await this.chain.windowNeedsReopen())) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new ApiError('RELAYER_BUSY');
  }
}

const jsonable = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
