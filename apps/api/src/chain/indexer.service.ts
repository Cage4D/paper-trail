/**
 * Catch-up-on-read event indexer (decision D3: no long-running watcher on Vercel).
 *
 * `catchUp()` reads PaperTrail logs from the stored cursor to the latest block (in chunks),
 * stores them in ChainEvent (idempotent on txHash+logIndex), and updates the projections
 * (exam status, centre confirmed/epoch/released, release tx). It is called before reads that
 * depend on chain state and by the cron endpoint. A Postgres advisory lock makes concurrent
 * calls cheap: whoever does not get the lock returns immediately.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { decodeEventLog, type Hex, type Log } from 'viem';
import { PAPERTRAIL_ABI } from '@paper-trail/shared';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from './chain.service.js';
import { config } from '../config.js';

const LOCK_ID = 7_000_002; // pg advisory lock key for the indexer
const CHUNK = 2_000n;
const MIN_INTERVAL_MS = 3_000;

@Injectable()
export class IndexerService {
  private readonly log = new Logger('Indexer');
  private lastRun = 0;
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
  ) {}

  /** Returns how many new events were stored, or null if another run holds the lock / ran just now. */
  async catchUp(force = false): Promise<{ stored: number; toBlock: bigint } | null> {
    if (!force && Date.now() - this.lastRun < MIN_INTERVAL_MS) return null;
    this.lastRun = Date.now();
    return this.db.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_ID}) AS locked`;
        if (!locked) return null;
        const id = this.chain.address.toLowerCase();
        const cursor = await tx.indexerCursor.findUnique({ where: { id } });
        let from = cursor ? cursor.lastBlock + 1n : config().PAPERTRAIL_DEPLOY_BLOCK;
        const latest = await this.chain.client.getBlockNumber();
        let stored = 0;
        while (from <= latest) {
          const to = from + CHUNK - 1n < latest ? from + CHUNK - 1n : latest;
          const logs = await this.chain.client.getLogs({ address: this.chain.address, fromBlock: from, toBlock: to });
          for (const l of logs) stored += await this.apply(tx, l);
          await tx.indexerCursor.upsert({ where: { id }, create: { id, lastBlock: to }, update: { lastBlock: to } });
          from = to + 1n;
        }
        if (stored) this.log.log(`stored ${stored} events up to block ${latest}`);
        return { stored, toBlock: latest };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
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
    // projections
    switch (ev.eventName) {
      case 'ExamCreated':
        await tx.exam.updateMany({ where: { onchainId: examId! }, data: { status: 'CREATED', createTx: l.transactionHash } });
        break;
      case 'CentreSet':
        await tx.centre.updateMany({ where: { onchainId: centreId!, exam: { onchainId: examId! } }, data: { confirmed: true, setTx: l.transactionHash } });
        break;
      case 'EpochChanged':
        await tx.centre.updateMany({
          where: { onchainId: centreId!, exam: { boardAddr: (a.board as string).toLowerCase() } },
          data: { currentEpoch: Number(a.epoch) },
        });
        break;
      case 'ShareReleased':
        await tx.shareBlob.updateMany({
          where: { examId: examId!, centreId: centreId!, examinerAddr: (a.examiner as string).toLowerCase() },
          data: { releaseTx: l.transactionHash, releasedEpoch: Number(a.epoch) },
        });
        break;
      case 'Released':
        await tx.centre.updateMany({ where: { onchainId: centreId!, exam: { onchainId: examId! } }, data: { released: true } });
        break;
    }
    return 1;
  }
}
