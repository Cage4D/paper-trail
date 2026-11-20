/**
 * Public audit timeline (spec §7.3), built from indexed PaperTrail events, plus the data a
 * viewer needs to check a paper against its commitment. GET /exams/:id/events is the polling
 * replacement for SSE (decision D3): pass ?after=<block>:<logIndex>.
 */
import { Inject, Injectable } from '@nestjs/common';
import { centreGroupKey, groupChainId, markersGroupKey } from '@paper-trail/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { IndexerService } from '../chain/indexer.service.js';
import { ApiError } from '../common/api-error.js';

@Injectable()
export class AuditService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(IndexerService) private readonly indexer: IndexerService,
  ) {}

  private async load(examId: string) {
    await this.indexer.catchUp().catch(() => null);
    const exam = /^0x[0-9a-fA-F]{64}$/.test(examId) ? await this.db.exam.findUnique({ where: { onchainId: examId.toLowerCase() }, include: { centres: true } }) : null;
    if (!exam) throw new ApiError('NOT_FOUND');
    const groupIds = [...exam.centres.map((c) => groupChainId(centreGroupKey(c.onchainId))), groupChainId(markersGroupKey(exam.onchainId))];
    const rows = await this.db.chainEvent.findMany({
      where: { OR: [{ examId: exam.onchainId }, { name: 'EpochChanged', centreId: { in: groupIds } }] },
      orderBy: [{ blockNumber: 'asc' }, { logIndex: 'asc' }],
    });
    // EpochChanged is per (board, group): keep only the exam board's
    const events = rows.filter((r) => r.name !== 'EpochChanged' || ((r.data as { board?: string }).board ?? '').toLowerCase() === exam.boardAddr);
    return { exam, events };
  }

  private view(r: { name: string; data: unknown; txHash: string; blockNumber: bigint; logIndex: number; centreId: string | null }) {
    return { name: r.name, block: r.blockNumber.toString(), logIndex: r.logIndex, cursor: `${r.blockNumber}:${r.logIndex}`, centreId: r.centreId, data: r.data, txHash: r.txHash, explorer: `${this.chain.explorer}/tx/${r.txHash}` };
  }

  async audit(examId: string) {
    const { exam, events } = await this.load(examId);
    return {
      examId: exam.onchainId,
      contract: this.chain.address,
      chainId: 9800,
      timeline: events.map((e) => this.view(e)),
      check: {
        how: 'SHA3-256 of the exact bytes of an opened copy must equal its on-chain commitment (PaperTrail.commitment(examId, centreId)).',
        masterCommitment: exam.masterCommitment,
        centres: exam.centres.map((c) => ({ centreId: c.onchainId, name: c.name, commitment: c.commitment, cipherHash: c.cipherHash })),
        marksRoot: exam.marksRoot,
      },
    };
  }

  async events(examId: string, after?: string) {
    const { events } = await this.load(examId);
    const [b, i] = (after ?? '').split(':').map((x) => (x ? BigInt(x) : -1n));
    const fresh = events.filter((e) => e.blockNumber > b || (e.blockNumber === b && BigInt(e.logIndex) > (i ?? -1n)));
    const out = fresh.map((e) => this.view(e));
    return { events: out, cursor: out.length ? out[out.length - 1].cursor : (after ?? null), pollAfterMs: 4000 };
  }
}
