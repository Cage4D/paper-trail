import { CanActivate, Controller, ExecutionContext, Get, HttpCode, Inject, Injectable, Post, UseGuards } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { formatEther } from 'viem';
import { ApiError } from '../common/api-error.js';
import { config } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { IndexerService } from '../chain/indexer.service.js';

/** Bearer ADMIN_TOKEN (or CRON_SECRET, which Vercel Cron sends) — compared in constant time. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const h = ctx.switchToHttp().getRequest<Request>().headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const ok = [config().ADMIN_TOKEN, process.env.CRON_SECRET].filter((x): x is string => !!x).some((secret) => {
      const a = Buffer.from(token);
      const b = Buffer.from(secret);
      return a.length === b.length && timingSafeEqual(a, b);
    });
    if (!ok) throw new ApiError('UNAUTHENTICATED');
    return true;
  }
}

@Controller()
@UseGuards(AdminGuard)
export class InternalController {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
  ) {}

  /** Vercel Cron target: catch the indexer up (D3). */
  @Post('internal/index')
  @HttpCode(200)
  async index() {
    const r = await this.indexer.catchUp(true);
    return r ? { stored: r.stored, toBlock: r.toBlock.toString() } : { skipped: true };
  }

  @Get('admin/relayer')
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
