import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { errorMessage, type ApiErrorBody } from '@paper-trail/shared';
import { ApiError } from './api-error.js';

/** Every error leaves the API as { error: { code, message, params } }. Internals are never echoed. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let body: ApiErrorBody;
    if (e instanceof ApiError) {
      status = e.status;
      body = { error: { code: e.code, message: e.message, ...(Object.keys(e.params).length ? { params: e.params } : {}) } };
    } else if (e instanceof HttpException && e.getStatus() === 404) {
      status = 404;
      body = { error: { code: 'NOT_FOUND', message: errorMessage('NOT_FOUND') } };
    } else if (e instanceof HttpException && e.getStatus() === 413) {
      status = 413;
      body = { error: { code: 'VALIDATION_FAILED', message: 'The upload is too large.' } };
    } else {
      // unexpected: log the message (no request bodies, no blobs), answer generically
      this.log.error(e instanceof Error ? `${e.name}: ${e.message}` : 'unknown error');
      status = 503;
      body = { error: { code: 'CHAIN_UNAVAILABLE', message: errorMessage('CHAIN_UNAVAILABLE') } };
    }
    res.status(status).json(body);
  }
}
