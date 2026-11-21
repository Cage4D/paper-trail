/**
 * Error catalog (spec §7.4). `message` is human copy the frontend shows as-is; `{name}`
 * placeholders are filled from `params`.
 */
export const ERRORS = {
  TOO_EARLY: { status: 409, message: "This paper is still sealed. It can be released from {startTime}." },
  NOT_RELEASED: { status: 409, message: "Waiting for a second examiner to release this centre's paper ({count} of 2)." },
  NOT_EXAMINER: { status: 403, message: "Only this exam's examiners can release it." },
  ALREADY_RELEASED: { status: 409, message: "You've already released this centre's paper." },
  NOT_A_MEMBER: { status: 403, message: "You're no longer on this centre's team, so new documents can't be opened." },
  COMMITMENT_MISMATCH: { status: 422, message: "This paper doesn't match what was set. Don't use it, and report it to the exam board." },
  KEY_NOT_REGISTERED: { status: 412, message: "Your post-quantum keys aren't registered yet. Finish setup first." },
  BAD_SIGNATURE: { status: 401, message: "That action wasn't signed by the right key." },
  RELAYER_BUSY: { status: 503, message: "The network is busy. Your action is saved and will be sent shortly." },
  CHAIN_UNAVAILABLE: { status: 503, message: "Can't reach QoreChain right now. Try again in a minute." },
  // API-level codes (not in the §7.4 table; plain copy, same shape)
  VALIDATION_FAILED: { status: 400, message: "Some of the details sent are missing or invalid." },
  UNAUTHENTICATED: { status: 401, message: "Please sign in first." },
  FORBIDDEN: { status: 403, message: "You don't have access to this." },
  NOT_FOUND: { status: 404, message: "That doesn't exist." },
  CONFLICT: { status: 409, message: "That already exists." },
  ACTION_REJECTED: { status: 422, message: "QoreChain refused this action: {reason}." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Try again in a few minutes." },
  INTERNAL: { status: 500, message: "Something went wrong on our side. Try again." },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; params?: Record<string, string | number> };
}

export function errorMessage(code: ErrorCode, params: Record<string, string | number> = {}): string {
  return ERRORS[code].message.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** Contract custom errors (PaperTrail.sol) → API error codes. */
export const CONTRACT_ERROR_CODES: Record<string, ErrorCode> = {
  TooEarly: "TOO_EARLY",
  NotReleased: "NOT_RELEASED",
  NotExaminer: "NOT_EXAMINER",
  AlreadyReleased: "ALREADY_RELEASED",
  KeyNotRegistered: "KEY_NOT_REGISTERED",
  BadSignature: "BAD_SIGNATURE",
};
