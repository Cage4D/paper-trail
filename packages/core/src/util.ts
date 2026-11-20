// Small byte helpers shared by the modules. No secrets are logged anywhere in core.
import { sha3_256 } from "@noble/hashes/sha3.js";
import { randomBytes as nobleRandom } from "@noble/hashes/utils.js";

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toHex(b: Uint8Array): `0x${string}` {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s as `0x${string}`;
}

export function fromHex(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new Error("invalid hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** bytes32 hex (0x + 64) → 32 bytes, checked. */
export function bytes32(h: string): Uint8Array {
  const b = fromHex(h);
  if (b.length !== 32) throw new Error("expected 32 bytes");
  return b;
}

export const sha3 = (b: Uint8Array): Uint8Array => sha3_256(b);
export const sha3Hex = (b: Uint8Array): `0x${string}` => toHex(sha3_256(b));
export const randomBytes = (n: number): Uint8Array => nobleRandom(n);

/** Overwrite secret bytes in place (best effort: JS cannot wipe copies or strings). */
export function wipe(...arrays: (Uint8Array | undefined)[]): void {
  for (const a of arrays) a?.fill(0);
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Unpadded base64url (also a valid QoreSeal purpose/context character set). */
export function b64url(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    const chars = i + 1 >= b.length ? 2 : i + 2 >= b.length ? 3 : 4;
    for (let j = 0; j < chars; j++) out += B64URL[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

/** QoreSeal purpose / batch-context rule (findings Q7): ^[A-Za-z0-9._:/-]{1,128}$ */
export const QORESEAL_LABEL_RE = /^[A-Za-z0-9._:/-]{1,128}$/;
export function checkLabel(label: string): string {
  if (!QORESEAL_LABEL_RE.test(label)) throw new Error(`invalid QoreSeal purpose/context: ${JSON.stringify(label)}`);
  return label;
}

/** Testnet chain id used for every QoreSeal envelope and SIWQ message (spec: testnet only). */
export const CHAIN_ID = "qorechain-diana";
export const EVM_CHAIN_ID = 9800n;
