/**
 * Event indexer (decision D3: catch-up on read + cron; no long-running watcher on Vercel).
 *
 *  - Our own relayed txs are ingested straight from their receipts (`ingest`), so projections such
 *    as `Released` update immediately.
 *  - `catchUp()` reads PaperTrail logs from the stored cursor towards the head, trailing it by
 *    CONFIRMATIONS blocks (a lagging RPC node cannot make it skip logs). Each chunk commits in its
 *    own short transaction together with the cursor, and one call processes at most
 *    MAX_CHUNKS_PER_CALL chunks, so a long backfill makes steady progress across calls instead
 *    of rolling back (bug-hunt finding 4). A session advisory try-lock keeps concurrent calls
 *    cheap.
 *  - Storage is idempotent on txHash+logIndex; projections update exam/centre/group/script state.
 *    Rows written as "pending" before relaying (rotations, releases, scripts, marks root,
 *    binding) are confirmed here by their events (bug-hunt finding 2).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { decodeEventLog, type Hex, type Log } from 'viem';
import { PAPERTRAIL_ABI } from '@paper-trail/shared';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LOCK, LockService } from '../common/lock.service.js';
import { ChainService } from './chain.service.js';
import { config } from '../config.js';

const CHUNK = 2_000n;
const MAX_CHUNKS_PER_CALL = 25;
const MIN_INTERVAL_MS = 3_000;
/** Cursor catch-up stops this many blocks behind the head. */
const CONFIRMATIONS = 3n;

@Injectable()
export class IndexerService {
  private readonly log = new Logger('Indexer');
  private lastRun = 0;
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(LockService) private readonly locks: LockService,
  ) {}

  /** Stored events and the block reached; null if another run holds the lock / ran just now. */
  async catchUp(force = false): Promise<{ stored: number; toBlock: bigint; done: boolean } | null> {
    if (!force && Date.now() - this.lastRun < MIN_INTERVAL_MS) return null;
    this.lastRun = Date.now();
    return this.locks.tryLock(LOCK.indexer, async () => {
      const id = this.chain.address.toLowerCase();
      const head = await this.chain.client.getBlockNumber();
      const latest = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;
      const cursor = await this.db.indexerCursor.findUnique({ where: { id } });
      let from = cursor ? cursor.lastBlock + 1n : config().PAPERTRAIL_DEPLOY_BLOCK;
      if (cursor && cursor.lastBlock > head) {
        // impossible on a healthy chain (a cursor from another chain or a test run): rescan rather than stall
        this.log.warn(`cursor ${cursor.lastBlock} is ahead of the chain head ${head}; rescanning from the deploy block`);
        from = config().PAPERTRAIL_DEPLOY_BLOCK;
      }
      let stored = 0;
      let reached = from - 1n;
      for (let n = 0; n < MAX_CHUNKS_PER_CALL && from <= latest; n++) {
        const to = from + CHUNK - 1n < latest ? from + CHUNK - 1n : latest;
        const logs = await this.chain.client.getLogs({ address: this.chain.address, fromBlock: from, toBlock: to });
        // one short transaction per chunk: its events + the cursor commit together
        stored += await this.db.$transaction(
          async (tx) => {
            let k = 0;
            for (const l of logs) k += await this.apply(tx, l);
            await tx.indexerCursor.upsert({ where: { id }, create: { id, lastBlock: to }, update: { lastBlock: to } });
            return k;
          },
          { timeout: 20_000 },
        );
        reached = to;
        from = to + 1n;
      }
      if (stored) this.log.log(`stored ${stored} events up to block ${reached}`);
      return { stored, toBlock: reached, done: from > latest };
    });
  }

  /** Ingest PaperTrail logs from a confirmed receipt (idempotent on txHash+logIndex). */
  async ingest(logs: readonly Log[]): Promise<number> {
    const mine = logs.filter((l) => l.address.toLowerCase() === this.chain.address.toLowerCase());
    if (!mine.length) return 0;
    return this.db.$transaction(async (tx) => {
      let n = 0;
      for (const l of mine) n += await this.apply(tx, l);
      return n;
    });
  }

  async lag(): Promise<bigint | null> {
    const cursor = await this.db.indexerCursor.findUnique({ where: { id: this.chain.address.toLowerCase() } });
    if (!cursor) return null;
    return (await this.chain.client.getBlockNumber()) - cursor.lastBlock;
  }

  private async apply(tx: Prisma.TransactionClient, l: Log): Promise<number> {
    let ev: { eventName: string; args: Record<string, unknown> };
    try {
      ev = decodeEventLog({ abi: PAPERTRAIL_ABI, data: l.data, topics: l.topics }) as unknown as typeof ev;
    } catch {
      return 0;
    }
    const a = ev.args;
    const examId = (a.examId as string | undefined)?.toLowerCase() ?? null;
    const centreId = (a.centreId as string | undefined)?.toLowerCase() ?? null;
    const data = JSON.parse(JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    const created = await tx.chainEvent.createMany({
      data: [{ name: ev.eventName, examId, centreId, data, txHash: l.transactionHash as Hex, blockNumber: l.blockNumber!, logIndex: l.logIndex! }],
      skipDuplicates: true,
    });
    if (!created.count) return 0;
    switch (ev.eventName) {
      case 'ExamCreated':
        await tx.exam.updateMany({ where: { onchainId: examId! }, data: { status: 'CREATED', createTx: l.transactionHash } });
        break;
      case 'CentreSet':
        await tx.centre.updateMany({ where: { onchainId: centreId!, exam: { onchainId: examId! } }, data: { confirmed: true, setTx: l.transactionHash } });
        break;
      case 'EpochChanged': {
        const board = (a.board as string).toLowerCase();
        const epoch = Number(a.epoch);
        await tx.centre.updateMany({ where: { onchainId: centreId!, exam: { boardAddr: board } }, data: { currentEpoch: epoch } });
        // confirm the pending envelope row for this (board, group, epoch) if its member list is the one signed on chain
        const env = await tx.epochEnvelope.findFirst({ where: { boardAddr: board, groupChainId: centreId!, epoch, membersHash: (a.membersHash as string).toLowerCase() } });
        if (env && !env.confirmed) {
          await tx.epochEnvelope.update({ where: { id: env.id }, data: { confirmed: true, txHash: l.transactionHash } });
          for (const address of env.added) await tx.member.create({ data: { boardAddr: board, groupKey: env.groupKey, role: env.role, address, addedEpoch: epoch } });
          if (env.removed.length) await tx.member.updateMany({ where: { boardAddr: board, groupKey: env.groupKey, address: { in: env.removed }, active: true }, data: { active: false, removedEpoch: epoch } });
        }
        break;
      }
      case 'ShareReleased':
        await tx.shareBlob.updateMany({
          where: { examId: examId!, centreId: centreId!, examinerAddr: (a.examiner as string).toLowerCase() },
          data: { releaseTx: l.transactionHash, releasedEpoch: Number(a.epoch) },
        });
        break;
      case 'Released':
        await tx.centre.updateMany({ where: { onchainId: centreId!, exam: { onchainId: examId! } }, data: { released: true } });
        break;
      case 'ScriptSubmitted':
        await tx.script.updateMany({ where: { examId: examId!, pseudonymHash: (a.pseudonymHash as string).toLowerCase(), txHash: null }, data: { txHash: l.transactionHash } });
        break;
      case 'MarksPublished':
        await tx.exam.updateMany({ where: { onchainId: examId!, marksRoot: (a.merkleRoot as string).toLowerCase() }, data: { marksStatus: 'PUBLISHED', marksTx: l.transactionHash } });
        break;
      case 'IdentityBound':
        await tx.user.updateMany({ where: { evmAddress: (a.role as string).toLowerCase(), bindStatementHash: (a.statementHash as string).toLowerCase() }, data: { bindRelayTx: l.transactionHash } });
        break;
    }
    return 1;
  }
}
