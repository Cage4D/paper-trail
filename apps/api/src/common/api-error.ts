import { ERRORS, errorMessage, type ErrorCode } from '@paper-trail/shared';

/** An error the frontend shows as-is (spec §7.4). */
export class ApiError extends Error {
  /**
   * true when the action MAY already be on chain (broadcast done, outcome unknown): callers must
   * keep their pending rows; the indexer / reconciliation confirms or fails them (finding 2).
   */
  sent = false;
  constructor(
    readonly code: ErrorCode,
    readonly params: Record<string, string | number> = {},
  ) {
    super(errorMessage(code, params));
  }
  get status(): number {
    return ERRORS[this.code].status;
  }
  static pending(txHash: string): ApiError {
    const e = new ApiError('RELAYER_BUSY', { txHash });
    e.sent = true;
    return e;
  }
}

/** True when an error from relay() means the action may have landed (keep pending rows). */
export const maybeSent = (e: unknown): boolean => e instanceof ApiError && e.sent;
