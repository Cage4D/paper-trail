import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { BaseError as ViemError } from 'viem';
import { errorMessage, type ApiErrorBody, type ErrorCode } from '@paper-trail/shared';
import { Prisma } from '../generated/prisma/client.js';
import { ApiError } from './api-error.js';

/**
 * Every error leaves the API as { error: { code, message, params } }. Internals are never echoed.
 * Unknown errors are classified (bug-hunt finding 10): Prisma unique violation → CONFLICT,
 * chain/RPC failures → CHAIN_UNAVAILABLE, anything else → INTERNAL (not "the chain is down").
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const send = (status: number, code: ErrorCode, params?: Record<string, string | number>, message?: string) => {
      const body: ApiErrorBody = { error: { code, message: message ?? errorMessage(code, params), ...(params && Object.keys(params).length ? { params } : {}) } };
      res.status(status).json(body);
    };
    if (e instanceof ApiError) return send(e.status, e.code, e.params, e.message);
    if (e instanceof HttpException) {
      const st = e.getStatus();
      if (st === 404) return send(404, 'NOT_FOUND');
      if (st === 413) return send(413, 'VALIDATION_FAILED', undefined, 'The upload is too large.');
      if (st === 400) return send(400, 'VALIDATION_FAILED');
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return send(409, 'CONFLICT');
    if (e instanceof ViemError || (e instanceof TypeError && /fetch/i.test(e.message))) {
      this.log.warn(`chain: ${e.message.split('\n')[0]}`);
      return send(503, 'CHAIN_UNAVAILABLE');
    }
    // unexpected: log the message (no request bodies, no blobs), answer generically
    this.log.error(e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : 'unknown error');
    return send(500, 'INTERNAL');
  }
}
