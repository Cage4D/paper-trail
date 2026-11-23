// The one place the web app talks to the Paper Trail API. Every failure becomes an ApiError whose
// `message` is the error-catalog copy, meant to be shown verbatim (handoff §5.1, §8).
import { ERRORS, type ApiErrorBody, type ErrorCode } from '@paper-trail/shared';
import { API_URL } from './config';

/** Catalog codes plus two client-side ones: the API was unreachable, or took too long. */
export type ClientErrorCode = ErrorCode | 'NETWORK' | 'TIMEOUT';

const CLIENT_MESSAGES: Record<'NETWORK' | 'TIMEOUT', string> = {
  NETWORK: "Can't reach the Paper Trail API right now. Try again in a minute.",
  TIMEOUT: 'QoreChain is taking longer than usual. Try again in a minute.',
};

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status = 0,
    readonly params: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Worth offering a "Try again" button for. */
  get retryable() {
    return ['CHAIN_UNAVAILABLE', 'INTERNAL', 'NETWORK', 'TIMEOUT'].includes(this.code);
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

interface Opts {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Defaults to 120 s: on-chain actions can take up to ~60 s when the EVM window has to reopen. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

function isErrorBody(x: unknown): x is ApiErrorBody {
  return !!x && typeof x === 'object' && 'error' in x && !!(x as ApiErrorBody).error && typeof (x as ApiErrorBody).error.code === 'string';
}

export async function api<T>(path: string, { method = 'GET', body, timeoutMs = 120_000, signal }: Opts = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (ctrl.signal.aborted) throw new ApiError('TIMEOUT', CLIENT_MESSAGES.TIMEOUT);
    throw new ApiError('NETWORK', CLIENT_MESSAGES.NETWORK);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    if (isErrorBody(json)) {
      const { code, message, params } = json.error;
      throw new ApiError(code, message || ERRORS[code]?.message || ERRORS.INTERNAL.message, res.status, params ?? {});
    }
    throw new ApiError('INTERNAL', ERRORS.INTERNAL.message, res.status);
  }
  return json as T;
}
