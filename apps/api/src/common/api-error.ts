import { ERRORS, errorMessage, type ErrorCode } from '@paper-trail/shared';

/** An error the frontend shows as-is (spec §7.4). */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly params: Record<string, string | number> = {},
  ) {
    super(errorMessage(code, params));
  }
  get status(): number {
    return ERRORS[this.code].status;
  }
}
