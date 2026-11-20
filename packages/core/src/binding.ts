/**
 * QoreX ↔ role-key binding (decision D2; QoreX 0.3.x cannot sign messages for our site).
 *
 *  1. The API issues a nonce; the user's QoreX wallet sends itself 1 uqor with
 *     memo = bindingMemo(nonce) through QoreX `signAndBroadcast` (a real QoreChain tx, signed
 *     by the QoreX account and verified by the chain).
 *  2. The statement below names the role address, the QoreX address, the nonce and that tx.
 *     The ROLE key signs PaperTrail.bindIdentity(role, SHA3-256(statement)) with ML-DSA-87,
 *     and the relayer submits it, so the binding is recorded on chain.
 */
import { sha3Hex, utf8 } from "./util.js";

export const BINDING_MEMO_PREFIX = "papertrail-bind:";
export const bindingMemo = (nonce: string) => `${BINDING_MEMO_PREFIX}${nonce}`;

export function bindingStatement(args: { roleAddress: string; qorexAddress: string; nonce: string; txHash: string }): string {
  return [
    "Paper Trail identity binding v1",
    `role: ${args.roleAddress}`,
    `qorex: ${args.qorexAddress}`,
    `nonce: ${args.nonce}`,
    `tx: ${args.txHash.toUpperCase()}`,
  ].join("\n");
}

export const statementHash = (statement: string): `0x${string}` => sha3Hex(utf8(statement));
