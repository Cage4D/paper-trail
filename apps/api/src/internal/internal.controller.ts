import { CanActivate, Controller, ExecutionContext, Get, HttpCode, Inject, Injectable, Post, UseGuards } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { formatEther } from 'viem';
import { ApiError } from '../common/api-error.js';
import { config } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { IndexerService } from '../chain/indexer.service.js';
import { RelayerService } from '../relayer/relayer.service.js';

const bearer = (req: Request) => {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
};
const matches = (token: string, secrets: (string | undefined)[]) =>
  secrets.filter((x): x is string => !!x).some((secret) => {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  });

/** Bearer ADMIN_TOKEN only — compared in constant time. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!matches(bearer(ctx.switchToHttp().getRequest<Request>()), [config().ADMIN_TOKEN])) throw new ApiError('UNAUTHENTICATED');
    return true;
  }
}

/** Bearer CRON_SECRET (what Vercel Cron sends) or ADMIN_TOKEN: only for the scheduled catch-up. */
@Injectable()
export class CronGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!matches(bearer(ctx.switchToHttp().getRequest<Request>()), [config().CRON_SECRET, config().ADMIN_TOKEN])) throw new ApiError('UNAUTHENTICATED');
    return true;
  }
}

@Controller()
export class InternalController {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
    @Inject(RelayerService) private readonly relayerSvc: RelayerService,
  ) {}

  /** Scheduled target (D3; Vercel Cron sends GET): finish pending relays by tx hash, then catch the indexer up. */
  @Get('internal/index')
  @UseGuards(CronGuard)
  indexGet() {
    return this.index();
  }

  @Post('internal/index')
  @UseGuards(CronGuard)
  @HttpCode(200)
  async index() {
    const reconciled = await this.relayerSvc.reconcile();
    const r = await this.indexer.catchUp(true);
    return { reconciled, ...(r ? { stored: r.stored, toBlock: r.toBlock.toString(), done: r.done } : { skipped: true }) };
  }

  @Get('admin/relayer')
  @UseGuards(AdminGuard)
  async relayer() {
    const r = await this.chain.relayer();
    const w = await this.chain.windowStatus();
    const jobs = await this.db.relayJob.findMany({ orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, action: true, signer: true, status: true, txHash: true, error: true, createdAt: true } });
    return {
      relayer: { qor: r.cosmos, evm: r.evm, balanceQor: formatEther(await this.chain.relayerBalanceWei()) },
      window: JSON.parse(JSON.stringify(w, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
      jobs,
    };
  }
}
