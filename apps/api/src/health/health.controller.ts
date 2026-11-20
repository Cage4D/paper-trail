import { Controller, Get, Inject } from '@nestjs/common';
import { formatEther } from 'viem';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { IndexerService } from '../chain/indexer.service.js';

/** GET /health: DB, RPC, relayer balance, window status, indexer lag (spec §7.1). Never secrets. */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
  ) {}

  @Get()
  async health() {
    const check = async <T>(fn: () => Promise<T>) => {
      try {
        return { ok: true as const, value: await fn() };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : 'error' };
      }
    };
    const [db, block, balance, window, lag] = await Promise.all([
      check(async () => (await this.db.$queryRaw`SELECT 1`, true)),
      check(async () => (await this.chain.client.getBlockNumber()).toString()),
      check(async () => formatEther(await this.chain.relayerBalanceWei())),
      check(async () => {
        const w = await this.chain.windowStatus();
        return w.found ? { live: w.live, remainingTxs: w.remainingTxs.toString(), remainingBlocks: w.remainingBlocks.toString(), allowedTargets: w.allowedTargets } : { live: false };
      }),
      check(async () => (await this.indexer.lag())?.toString() ?? null),
    ]);
    const ok = db.ok && block.ok && balance.ok && window.ok;
    return { ok, contract: this.chain.address, db, rpc: block, relayerBalanceQor: balance, window, indexerLagBlocks: lag };
  }
}
