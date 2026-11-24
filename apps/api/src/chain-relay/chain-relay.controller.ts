/**
 * Browser relay for QoreChain's native lane. QoreChain's REST and Tendermint RPC endpoints send no
 * CORS headers, so a browser can't register its own PQC and KEM keys. This forwards, unchanged:
 *   GET  /chain/rest/<path>  — allowlisted read paths only (account, balance, key status, tx lookup)
 *   POST /chain/rpc          — allowlisted Tendermint JSON-RPC methods (status, broadcast, lookups)
 * It holds no keys and can't alter what it forwards: transactions are signed in the browser (classical
 * + ML-DSA-87) before they get here, and the chain checks those signatures. Rate-limited per IP.
 */
import { Body, Controller, Get, HttpCode, Inject, Ip, Logger, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '../common/api-error.js';
import { RateLimitService } from '../common/rate-limit.service.js';
import { config } from '../config.js';

const ADDR = '(?:qor1[02-9ac-hj-np-z]{38,58}|0x[0-9a-fA-F]{40})';
/** The only REST paths a browser needs to register its keys and show its balance. */
export const REST_ALLOW: RegExp[] = [
  new RegExp(`^/cosmos/auth/v1beta1/accounts/${ADDR}$`),
  new RegExp(`^/cosmos/bank/v1beta1/balances/${ADDR}(?:/by_denom)?$`),
  new RegExp(`^/qorechain/pqc/v1/account/${ADDR}$`),
  new RegExp(`^/qorechain/pqc/v1/kem/${ADDR}$`),
  /^\/qorechain\/pqc\/v1\/protocol_features$/,
  /^\/cosmos\/upgrade\/v1beta1\/applied_plan\/[A-Za-z0-9._-]{1,64}$/,
  /^\/cosmos\/tx\/v1beta1\/txs\/[0-9A-Fa-f]{64}$/,
  /^\/cosmos\/base\/tendermint\/v1beta1\/(?:node_info|blocks\/latest)$/,
];
/** Tendermint JSON-RPC methods: read-only lookups plus broadcasting an already-signed tx. */
export const RPC_ALLOW = new Set(['status', 'abci_info', 'abci_query', 'block', 'tx', 'tx_search', 'broadcast_tx_sync', 'broadcast_tx_async', 'broadcast_tx_commit']);
const BROADCASTS = new Set(['broadcast_tx_sync', 'broadcast_tx_async', 'broadcast_tx_commit']);
const MAX_RPC_BODY = 256 * 1024;

const rest = () => config().QORE_REST.replace(/\/+$/, '');
const rpc = () => (config().QORE_RPC || 'https://rpc-testnet.qore.host').replace(/\/+$/, '');

@Controller('chain')
export class ChainRelayController {
  private readonly log = new Logger('ChainRelay');
  constructor(@Inject(RateLimitService) private readonly limits: RateLimitService) {}

  @Get('rest/*path')
  async restGet(@Req() req: Request, @Res() res: Response, @Ip() ip: string) {
    const full = req.originalUrl.replace(/^.*?\/chain\/rest/, '');
    const [path, query = ''] = full.split('?');
    if (!REST_ALLOW.some((r) => r.test(path))) {
      this.log.warn(`rest path refused: ${path.slice(0, 120)}`);
      throw new ApiError('FORBIDDEN');
    }
    await this.limits.hit(`chain:${ip ?? 'unknown'}`, 300, 10 * 60_000);
    const r = await fetch(`${rest()}${path}${query ? `?${query}` : ''}`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!r) throw new ApiError('CHAIN_UNAVAILABLE');
    res.status(r.status).type(r.headers.get('content-type') ?? 'application/json').send(await r.text());
  }

  @Post('rpc')
  @HttpCode(200)
  async rpcPost(@Body() body: unknown, @Ip() ip: string, @Req() req: Request) {
    if (Number(req.headers['content-length'] ?? 0) > MAX_RPC_BODY) throw new ApiError('VALIDATION_FAILED', { fields: 'body (too large)' });
    const calls = Array.isArray(body) ? body : [body];
    if (!calls.length || calls.length > 5) throw new ApiError('VALIDATION_FAILED', { fields: 'body' });
    for (const c of calls) {
      const m = (c as { method?: unknown })?.method;
      if (typeof m !== 'string' || !RPC_ALLOW.has(m)) {
        this.log.warn(`rpc method refused: ${String(m).slice(0, 60)}`);
        throw new ApiError('FORBIDDEN');
      }
    }
    await this.limits.hit(`chain:${ip ?? 'unknown'}`, 300, 10 * 60_000);
    if (calls.some((c) => BROADCASTS.has((c as { method: string }).method))) await this.limits.hit(`chain-broadcast:${ip ?? 'unknown'}`, 20, 10 * 60_000);
    const r = await fetch(rpc(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (!r) throw new ApiError('CHAIN_UNAVAILABLE');
    return r.json();
  }
}
