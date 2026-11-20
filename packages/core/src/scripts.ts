/**
 * Answer scripts and pseudonyms (spec §4.2, §6 scripts.ts).
 *
 *  - A candidate's script is sealed (QoreSeal, multi-recipient) to the current markers, purpose
 *    "papertrail:script:v1", aad = examId ‖ centreId ‖ pseudonymHash. Markers only ever
 *    see the pseudonym.
 *  - pseudonymHash = SHA3-256(examId ‖ pseudonym) goes on chain (`submitScript`).
 *  - The pseudonym → candidate map is sealed to the board only ("papertrail:identity:v1").
 */
import { open, seal, type SealKeyPair, type SealRecipient } from "@qorechain/qoreseal";
import { PURPOSE } from "./split.js";
import { CHAIN_ID, b64url, bytes32, concat, fromUtf8, randomBytes, sha3Hex, utf8, wipe } from "./util.js";

export function newPseudonym(): string {
  return `ps_${b64url(randomBytes(16))}`;
}

export function pseudonymHash(examId: string, pseudonym: string): `0x${string}` {
  return sha3Hex(concat(bytes32(examId), utf8(pseudonym)));
}

const scriptAad = (examId: string, centreId: string, ph: string) => concat(bytes32(examId), bytes32(centreId), bytes32(ph));

export function sealScript(args: { examId: string; centreId: string; pseudonym: string; answers: unknown; markers: SealRecipient[] }) {
  if (!args.markers.length) throw new Error("no markers to seal to");
  const ph = pseudonymHash(args.examId, args.pseudonym);
  const pt = utf8(JSON.stringify({ v: 1, pseudonym: args.pseudonym, answers: args.answers }));
  const envelope = seal({ chainId: CHAIN_ID, purpose: PURPOSE.script, plaintext: pt, aad: scriptAad(args.examId, args.centreId, ph), recipients: args.markers });
  wipe(pt);
  return { envelope, scriptHash: sha3Hex(envelope), pseudonymHash: ph };
}

export function openScript(args: { envelope: Uint8Array; keys: SealKeyPair; examId: string; centreId: string; pseudonymHash: string }) {
  const pt = open({ chainId: CHAIN_ID, purpose: PURPOSE.script, envelope: args.envelope, keys: args.keys, aad: scriptAad(args.examId, args.centreId, args.pseudonymHash) });
  const body = JSON.parse(fromUtf8(pt)) as { v: 1; pseudonym: string; answers: unknown };
  wipe(pt);
  if (pseudonymHash(args.examId, body.pseudonym) !== args.pseudonymHash) throw new Error("script pseudonym does not match its hash");
  return body;
}

export function sealIdentityMap(args: { examId: string; map: Record<string, string>; board: SealRecipient }): Uint8Array {
  const pt = utf8(JSON.stringify(args.map));
  const env = seal({ chainId: CHAIN_ID, purpose: PURPOSE.identity, plaintext: pt, aad: bytes32(args.examId), recipients: [args.board] });
  wipe(pt);
  return env;
}

export function openIdentityMap(args: { examId: string; envelope: Uint8Array; keys: SealKeyPair }): Record<string, string> {
  const pt = open({ chainId: CHAIN_ID, purpose: PURPOSE.identity, envelope: args.envelope, keys: args.keys, aad: bytes32(args.examId) });
  const map = JSON.parse(fromUtf8(pt));
  wipe(pt);
  return map;
}
