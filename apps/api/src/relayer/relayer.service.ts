/**
 * The untrusted relayer (spec §3.1, §7.1). It cannot forge anything: every action carries the
 * role holder's ML-DSA-87 signature, which PaperTrail checks on chain. It pays gas and holds the
 * EVM window.
 *
 * relay() under one session-level Postgres advisory lock (LockService; serialises ALL sends, so
 * per-signer nonces land in order and the relayer's own EVM nonce is never raced):
 *   1. the signer has a registered ML-DSA-87 key (pqcKeyStatus);
 *   2. digest = core.buildAction(...) with the signer's CURRENT on-chain nonce, and the
 *      signature is verified off-chain first with the real pqcVerify precompile (eth_call);
 *   3. the EVM window is reopened lazily (narrowed to PaperTrail) when low;
 *   4. simulate (retried on transient RPC errors; contract reverts → catalog codes);
 *   5. SIGN ONCE: the raw tx is signed locally, so its hash is known before broadcast; the job is
 *      recorded as SUBMITTED with that hash OUTSIDE any transaction; the same raw bytes are
 *      (re)broadcast on transient errors — idempotent, never a second signature;
 *   6. wait for the receipt by hash, up to RECEIPT_WAIT_MS. If it does not come in time the error
 *      is `sent` (RELAYER_BUSY): callers keep their pending rows and reconcile() / the indexer
 *      finish the job later. Nothing is ever resent with a new nonce (bug-hunt finding 2).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, keccak256, type Hex } from 'viem';
import { classifyEvmWindowRejection } from '@qorechain/evm';
import { Action, buildAction, type ActionFields } from '@paper-trail/core';
import { CONTRACT_ERROR_CODES } from '@paper-trail/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { IndexerService } from '../chain/indexer.service.js';
import { LOCK, LockService } from '../common/lock.service.js';
import { ApiError } from '../common/api-error.js';
import { config } from '../config.js';

export const RECEIPT_WAIT_MS = 60_000;
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

export interface RelayContext {
  /** What the job is for (retries / reconciliation), e.g. "centre:<examId>:<centreId>". */
  ref?: string;
  examId?: string;
}

@Injectable()
export class RelayerService {
  private readonly log = new Logger('Relayer');
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
    @Inject(LockService) private readonly locks: LockService,
  ) {}

  /** Latest job for a ref: lets callers tell "pending" from "failed" from "done" on retries. */
  async jobFor(ref: string) {
    return this.db.relayJob.findFirst({ where: { ref }, orderBy: { createdAt: 'desc' } });
  }

  async relay<A extends Action>(action: A, signer: Hex, fields: ActionFields[A], signature: Hex, ctx: RelayContext = {}): Promise<RelayResult> {
    const key = await this.call(() => this.chain.pqcKeyStatus(signer));
    if (!key.registered || key.algorithmId !== 1) throw new ApiError('KEY_NOT_REGISTERED');
    const job = await this.db.relayJob.create({
      data: { action: Action[action], signer: signer.toLowerCase(), payload: jsonable(fields), status: 'QUEUED', ref: ctx.ref, examId: ctx.examId?.toLowerCase() },
    });
    const tag = `${Action[action]} exam=${ctx.examId ?? '-'} signer=${signer}`;
    try {
      const res = await this.locks.withLock(LOCK.relay, () => this.sendLocked(action, signer, fields, signature, key.pubkey, job.id));
      await this.db.relayJob.update({ where: { id: job.id }, data: { status: 'CONFIRMED', txHash: res.txHash } });
      await this.indexer.ingest(res.logs).catch((e: Error) => this.log.warn(`receipt ingest failed: ${e.message.split('\n')[0]}`));
      this.log.log(`${tag} tx=${res.txHash} gas=${res.gasUsed}`);
      const { logs: _logs, ...out } = res;
      return { jobId: job.id, ...out };
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('RELAYER_BUSY');
      if (err.sent) {
        // may be on chain: leave the job SUBMITTED for reconcile(); callers keep their rows
        this.log.warn(`${tag} pending tx=${err.params.txHash}`);
      } else {
        await this.db.relayJob.update({ where: { id: job.id }, data: { status: 'FAILED', error: err.code } }).catch(() => undefined);
        if (!(e instanceof ApiError)) this.log.error(`${tag} failed: ${e instanceof Error ? e.message.split('\n')[0] : 'unknown'}`);
      }
      throw err;
    }
  }

  private async sendLocked<A extends Action>(action: A, signer: Hex, fields: ActionFields[A], signature: Hex, pubkey: Hex, jobId: string) {
    const nonce = await this.call(() => this.chain.nonceOf(signer));
    const built = buildAction(action, fields, { chainId: config().CHAIN_ID, contract: this.chain.address, signer, nonce });
    if (!(await this.call(() => this.chain.pqcVerify(pubkey, signature, built.digest)))) throw new ApiError('BAD_SIGNATURE');

    let windowReopened: string | undefined;
    const reopen = async () => {
      windowReopened = await this.chain.openWindow();
      this.log.log(`window reopened tx=${windowReopened}`);
      await this.waitForWindow();
    };
    if (await this.call(() => this.chain.windowNeedsReopen())) await reopen();

    const args = [...built.args, signature];
    const wallet = await this.chain.wallet();
    // simulate (safe to retry), then sign exactly once
    await this.mapReverts(() => this.chain.client.simulateContract({ address: this.chain.address, abi: this.chain.abi, functionName: FUNCTION[action], args, account: wallet.account }));
    const data = encodeFunctionData({ abi: this.chain.abi, functionName: FUNCTION[action] as string, args } as never);
    const signRaw = async () => {
      const prepared = await this.call(() => wallet.prepareTransactionRequest({ account: wallet.account, chain: wallet.chain, to: this.chain.address, data }));
      const raw = await wallet.signTransaction(prepared as never);
      return { raw, hash: keccak256(raw) };
    };
    let { raw, hash } = await signRaw();
    await this.db.relayJob.update({ where: { id: jobId }, data: { status: 'SUBMITTED', txHash: hash, attempts: { increment: 1 } } });
    try {
      await this.broadcast(raw);
    } catch (e) {
      // the window refused it (expired / used up between check and send): the tx was NOT accepted,
      // so reopen (which advances the account nonce) and sign a replacement exactly once
      if (classifyEvmWindowRejection(e) && !windowReopened) {
        await reopen();
        ({ raw, hash } = await signRaw());
        await this.db.relayJob.update({ where: { id: jobId }, data: { txHash: hash, attempts: { increment: 1 } } });
        await this.broadcast(raw);
      } else if (!(e instanceof ApiError)) {
        // ambiguous transport failure: it may have reached the mempool; look for it by hash below
        this.log.warn(`broadcast error (will check by hash): ${e instanceof Error ? e.message.split('\n')[0] : 'unknown'}`);
      } else throw e;
    }
    let receipt;
    try {
      receipt = await this.chain.client.waitForTransactionReceipt({ hash, timeout: RECEIPT_WAIT_MS, pollingInterval: 1_500 });
    } catch {
      throw ApiError.pending(hash);
    }
    if (receipt.status !== 'success') throw new ApiError('ACTION_REJECTED', { reason: 'the transaction reverted' });
    return { txHash: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, logs: receipt.logs, windowReopened };
  }

  /** (Re)broadcast the same signed bytes: idempotent. "Already known" means it is in the mempool. */
  private async broadcast(raw: Hex): Promise<void> {
    for (let i = 1; ; i++) {
      try {
        await this.chain.client.sendRawTransaction({ serializedTransaction: raw });
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : '';
        if (msg.includes('already known') || msg.includes('already in mempool') || msg.includes('nonce too low')) return;
        if (classifyEvmWindowRejection(e) || i >= 3) throw e;
        await new Promise((r) => setTimeout(r, 700 * i));
      }
    }
  }

  /**
   * Finish SUBMITTED jobs whose receipt did not arrive in time (cron, D3): mined → ingest logs and
   * confirm; reverted → failed; not found after 15 minutes → failed (dropped).
   */
  async reconcile(): Promise<{ confirmed: number; failed: number; pending: number }> {
    const jobs = await this.db.relayJob.findMany({ where: { status: 'SUBMITTED', updatedAt: { lt: new Date(Date.now() - 20_000) } }, take: 50 });
    let confirmed = 0;
    let failed = 0;
    for (const j of jobs) {
      const receipt = await this.chain.client.getTransactionReceipt({ hash: j.txHash as Hex }).catch(() => null);
      if (receipt?.status === 'success') {
        await this.indexer.ingest(receipt.logs).catch(() => 0);
        await this.db.relayJob.update({ where: { id: j.id }, data: { status: 'CONFIRMED' } });
        confirmed++;
      } else if (receipt) {
        await this.db.relayJob.update({ where: { id: j.id }, data: { status: 'FAILED', error: 'REVERTED' } });
        failed++;
      } else if (j.updatedAt.getTime() < Date.now() - 15 * 60_000) {
        await this.db.relayJob.update({ where: { id: j.id }, data: { status: 'FAILED', error: 'DROPPED' } });
        failed++;
      }
    }
    return { confirmed, failed, pending: jobs.length - confirmed - failed };
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

  /** Retry transient RPC/network failures of READS and SIMULATION only (never a signed send). */
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
