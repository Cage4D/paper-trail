/**
 * Sign In With QoreChain, signed by the Paper Trail ROLE key (decision D2).
 *
 * QoreX 0.3.x cannot sign arbitrary messages for a third-party site (findings Q2), so the
 * role key — a full QoreChain account with a classical and an ML-DSA-87 key — signs the
 * SIWQ message itself. The API verifies it against the ML-DSA key registered on chain
 * (`verifySignInWithChain`).
 */
import { createSiwqMessage, signSiwq, verifySiwq, type SiwqFields, type SiwqSignature } from "@qorechain/qoresign";
import { verifySiwqWithChain } from "@qorechain/qoresign/network";
import type { RoleKey } from "./keys.js";
import { CHAIN_ID } from "./util.js";

export type { SiwqSignature };

export interface SignInRequest {
  domain: string;
  uri: string;
  address: string;
  nonce: string;
  statement?: string;
  issuedAt?: string;
  expirationTime?: string;
}

export function createSignIn(req: SignInRequest): string {
  const fields: SiwqFields = {
    domain: req.domain,
    address: req.address,
    statement: req.statement ?? "Sign in to Paper Trail with your role key.",
    uri: req.uri,
    version: "1",
    chainId: CHAIN_ID,
    nonce: req.nonce,
    issuedAt: req.issuedAt ?? new Date().toISOString(),
    ...(req.expirationTime ? { expirationTime: req.expirationTime } : {}),
  };
  return createSiwqMessage(fields);
}

/** Hybrid SIWQ signature (ADR-36 secp256k1 + ML-DSA-87 over "qorechain-siwq-v1|" + message). */
export function signSignIn(role: RoleKey, message: string): SiwqSignature {
  return signSiwq({ message, classicalKey: role.classical, pqKey: role.pq });
}

/** Offline verification against a known ML-DSA-87 public key. */
export function verifySignIn(args: { message: string; signature: SiwqSignature; domain: string; nonce: string; pqPublicKey: Uint8Array; now?: Date }) {
  return verifySiwq({ ...args, chainId: CHAIN_ID });
}

/** Verification against the key registered on chain (API side). */
export function verifySignInWithChain(args: { message: string; signature: SiwqSignature; domain: string; nonce: string; address: string; rest: string; now?: Date }) {
  return verifySiwqWithChain({ ...args, chainId: CHAIN_ID });
}
