import { Controller, Get, Inject } from '@nestjs/common';
import { formatEther, parseEther } from 'viem';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { IndexerService } from '../chain/indexer.service.js';

/** Below this the relayer may run dry during judging (~0.41 QOR per demo run + 0.1 QOR per window reopen). */
export const RELAYER_LOW_QOR = '2';
const FAUCET = 'https://dashboard.qorechain.io/faucet';

/**
 * GET /health: DB, RPC, relayer balance, window status, indexer lag (spec §7.1). Never secrets.
 * `warnings` flags a low relayer balance (with the address to fund) while `ok` stays true: a low
 * balance is not an outage yet, but whoever watches the uptime ping should claim the faucet.
 */
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
    const warnings: string[] = [];
    if (balance.ok && parseEther(balance.value) < parseEther(RELAYER_LOW_QOR)) {
      const r = await this.chain.relayer();
      warnings.push(`Relayer balance is low (${balance.value} QOR, below ${RELAYER_LOW_QOR}). Claim testnet QOR for ${r.cosmos} at ${FAUCET}.`);
    }
    return { ok, warnings, contract: this.chain.address, db, rpc: block, relayerBalanceQor: balance, window, indexerLagBlocks: lag };
  }
}
