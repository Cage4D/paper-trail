import { b64url, fromB64url, sha3Hex } from '@paper-trail/core';
import { ApiError } from './api-error.js';

export const toB64url = (b: Uint8Array): string => b64url(b);
export function decodeBlob(s: string, field: string, maxBytes = 512 * 1024): Uint8Array<ArrayBuffer> {
  let b: Uint8Array;
  try {
    b = fromB64url(s);
  } catch {
    throw new ApiError('VALIDATION_FAILED', { fields: field });
  }
  if (!b.length || b.length > maxBytes) throw new ApiError('VALIDATION_FAILED', { fields: field });
  return new Uint8Array(b); // ArrayBuffer-backed copy (Prisma Bytes)
}
export { sha3Hex };
export const lower = (a: string) => a.toLowerCase();
