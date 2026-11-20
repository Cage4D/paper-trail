/**
 * Releasing and opening a centre's paper (spec §4.2, §6 release.ts) — design option B, agreed
 * in Phase 3:
 *
 *   Each releasing examiner opens their own share of K_c and seals it with QoreSeal directly to
 *   the centre's CURRENT invigilators (the members of the board's epoch group at the epoch the
 *   contract records), purpose "papertrail:release:v1", aad = examId ‖ centreId ‖ epoch (u64).
 *
 * Why not sealBatch under the epoch key (spec wording): examiners never hold centre epoch keys
 * (they are sealed to invigilators only). Sealing straight to the epoch's members keeps the same
 * property — a removed invigilator is not a recipient and cannot open the release — without
 * handing examiners the groups' keys or routing shares through the board (which must never
 * hold two shares).
 *
 * The API can check a release blob before relaying: `releaseRecipientsMatch` compares the
 * envelope's recipient hints with that epoch's member recipients.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { open, parseEnvelope, recipientHint, seal, type SealKeyPair, type SealRecipient } from "@qorechain/qoreseal";
import { combine } from "shamir-secret-sharing";
import { commitmentOf } from "./paper.js";
import { _cipherAad, openShare } from "./split.js";
import { CHAIN_ID, bytes32, concat, fromUtf8, sha3Hex, wipe } from "./util.js";

export const RELEASE_PURPOSE = "papertrail:release:v1";

const u64 = (n: bigint | number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n));
  return b;
};
const releaseAad = (examId: string, centreId: string, epoch: bigint | number) => concat(bytes32(examId), bytes32(centreId), u64(epoch));

export class CommitmentMismatchError extends Error {
  readonly code = "COMMITMENT_MISMATCH";
  constructor() {
    super("This paper doesn't match what was set. Don't use it, and report it to the exam board.");
  }
}

/** Examiner side: turn my sealed share into a release blob for the centre's current invigilators. */
export function prepareRelease(args: {
  shareEnvelope: Uint8Array;
  examinerKeys: SealKeyPair;
  examinerIndex: number;
  examId: `0x${string}`;
  centreId: `0x${string}`;
  /** The centre's current epoch, as the contract will record it (centreEpoch[board][centreId]). */
  epoch: bigint | number;
  /** That epoch's invigilators (board's published member list + their recipient cards). */
  invigilators: SealRecipient[];
}): { blob: Uint8Array; blobHash: `0x${string}` } {
  if (!args.invigilators.length) throw new Error("the centre has no invigilators to release to");
  const share = openShare({ envelope: args.shareEnvelope, keys: args.examinerKeys, examId: args.examId, centreId: args.centreId, examinerIndex: args.examinerIndex });
  const plaintext = concat(new Uint8Array([args.examinerIndex]), share);
  const blob = seal({ chainId: CHAIN_ID, purpose: RELEASE_PURPOSE, plaintext, aad: releaseAad(args.examId, args.centreId, args.epoch), recipients: args.invigilators });
  wipe(share, plaintext);
  return { blob, blobHash: sha3Hex(blob) };
}

/** API side: is this release blob sealed to exactly these recipients (that epoch's members)? */
export function releaseRecipientsMatch(blob: Uint8Array, members: SealRecipient[]): boolean {
  return sealedToExactly(blob, members.map((m) => m.mlkemPublicKey));
}

/** Is a QoreSeal envelope sealed to exactly these ML-KEM keys (by its recipient hints)? */
export function sealedToExactly(blob: Uint8Array, mlkemPublicKeys: Uint8Array[]): boolean {
  const members = mlkemPublicKeys.map((mlkemPublicKey) => ({ mlkemPublicKey }));
  const env = parseEnvelope(blob);
  if (env.anonymous || env.entries.length !== members.length) return false;
  const want = new Set(members.map((m) => sha3Hex(recipientHint(env.salt, m.mlkemPublicKey))));
  return env.entries.every((e) => want.delete(sha3Hex(e.hint))) && want.size === 0;
}

/**
 * Invigilator side: open two released shares, rebuild K_c, decrypt the centre's copy and check
 * it against the on-chain commitment. Throws NOT_A_MEMBER-style QoreSeal errors when this
 * invigilator was not a recipient, and CommitmentMismatchError when the text differs.
 */
export async function openPaper(args: {
  released: { blob: Uint8Array; epoch: bigint | number }[];
  invigilatorKeys: SealKeyPair;
  examId: `0x${string}`;
  centreId: `0x${string}`;
  cipher: Uint8Array;
  /** The on-chain commitment (PaperTrail.commitment[examId][centreId]). */
  commitment: `0x${string}`;
}): Promise<{ text: string; authentic: true }> {
  if (args.released.length < 2) throw new Error("two released shares are needed");
  const shares: Uint8Array[] = [];
  const seen = new Set<number>();
  for (const r of args.released.slice(0, 2)) {
    let pt: Uint8Array;
    try {
      pt = open({ chainId: CHAIN_ID, purpose: RELEASE_PURPOSE, envelope: r.blob, keys: args.invigilatorKeys, aad: releaseAad(args.examId, args.centreId, r.epoch) });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "NOT_A_RECIPIENT") throw Object.assign(new Error("NOT_A_MEMBER"), { code: "NOT_A_MEMBER", cause: e });
      throw e;
    }
    if (seen.has(pt[0])) throw new Error("both released shares come from the same examiner");
    seen.add(pt[0]);
    shares.push(pt.slice(1));
    wipe(pt);
  }
  const kc = await combine(shares);
  wipe(...shares);
  let body: Uint8Array;
  try {
    body = gcm(kc, args.cipher.slice(0, 12), _cipherAad(args.examId, args.centreId, args.commitment)).decrypt(args.cipher.slice(12));
  } catch {
    throw new CommitmentMismatchError();
  } finally {
    wipe(kc);
  }
  const text = fromUtf8(body);
  wipe(body);
  if (commitmentOf(text) !== args.commitment) throw new CommitmentMismatchError();
  return { text, authentic: true };
}
