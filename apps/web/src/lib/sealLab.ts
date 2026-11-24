// The "Try the encryption" lab: real @paper-trail/core crypto, run in the browser (inside a Web
// Worker, see workers/crypto.worker.ts). Pure functions over the core module so they can be tested
// directly. Secret keys stay inside whoever calls these (the worker); only public facts come back.
import type * as Core from '@paper-trail/core';

type CoreModule = typeof Core;
export type RoleKey = Core.RoleKey;

export interface KeyInfo {
  /** qor1… address derived from the new key (public; never registered, holds nothing) */
  address: string;
  /** size of the ML-KEM-1024 public key in bytes (1568) */
  kemPublicKeyBytes: number;
  /** SHA3-256 of the ML-KEM-1024 public key: a short code for it */
  kemPublicKeyCode: string;
  ms: number;
}

export interface SealedInfo {
  bytes: number;
  /** SHA3-256 of the sealed envelope */
  code: string;
  /** first bytes of the envelope, hex, to show it's unreadable */
  preview: string;
  recipients: number;
  ms: number;
}

export interface Sealed {
  envelope: Uint8Array;
  examId: string;
  centreId: string;
  pseudonymHash: string;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function makeKey(core: CoreModule): { key: RoleKey; info: KeyInfo } {
  const t = now();
  const key = core.createRoleKey();
  return {
    key,
    info: {
      address: key.address,
      kemPublicKeyBytes: key.seal.mlkemPublicKey.length,
      kemPublicKeyCode: core.sha3Hex(key.seal.mlkemPublicKey),
      ms: Math.round(now() - t),
    },
  };
}

/**
 * Lock a note with the same code that locks a candidate's answer script (core.sealScript: QoreSeal,
 * ML-KEM-1024 + X25519, purpose "papertrail:script:v1"), for `key` and any extra recipients.
 */
export function sealNote(core: CoreModule, args: { key: RoleKey; text: string; examId: string; centreId: string; extra?: Core.RoleKey['recipient'][] }): { sealed: Sealed; info: SealedInfo } {
  const t = now();
  const recipients = [args.key.recipient, ...(args.extra ?? [])];
  const s = core.sealScript({ examId: args.examId, centreId: args.centreId, pseudonym: core.newPseudonym(), answers: { note: args.text }, markers: recipients });
  return {
    sealed: { envelope: s.envelope, examId: args.examId, centreId: args.centreId, pseudonymHash: s.pseudonymHash },
    info: { bytes: s.envelope.length, code: s.scriptHash, preview: core.toHex(s.envelope.slice(0, 48)), recipients: recipients.length, ms: Math.round(now() - t) },
  };
}

/** Open a note with a key. Throws (QoreSeal NOT_A_RECIPIENT) when the key isn't one of the recipients. */
export function openNote(core: CoreModule, args: { key: RoleKey; sealed: Sealed }): { text: string; ms: number } {
  const t = now();
  const body = core.openScript({ envelope: args.sealed.envelope, keys: args.key.seal, examId: args.sealed.examId, centreId: args.sealed.centreId, pseudonymHash: args.sealed.pseudonymHash });
  return { text: String((body.answers as { note?: unknown })?.note ?? ''), ms: Math.round(now() - t) };
}

/** The error code QoreSeal gives when a key can't open an envelope (for display). */
export function errorCode(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  return typeof code === 'string' ? code : e instanceof Error ? e.message : String(e);
}
