/**
 * Setting an exam (spec §4.2, §6 split.ts) — runs on the setting examiner's client.
 *
 *  - examSecret (32 random bytes) drives every canary variant (paper.ts).
 *  - Committee bundle = { examSecret, paper, fingerprint tables } sealed with QoreSeal to the
 *    3 examiners + the board, purpose "papertrail:committee:v1", aad = examId.
 *  - Per centre c: a fresh AES-256-GCM key K_c encrypts the variant:
 *      C_c = nonce(12) ‖ AES-GCM(K_c, nonce, variant bytes, aad = examId ‖ centreId ‖ commitment_c)
 *    K_c is split 2-of-3 with `shamir-secret-sharing`; share i is sealed to examiner i,
 *    purpose "papertrail:share:v1", aad = examId ‖ centreId ‖ i. K_c and the shares are wiped.
 * The server only ever receives envelopes, ciphertexts and hashes.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { seal, open, type SealKeyPair, type SealRecipient } from "@qorechain/qoreseal";
import { split as shamirSplit } from "shamir-secret-sharing";
import { generateCopies, parsePaper, type CopiesResult, type FingerprintTable } from "./paper.js";
import { CHAIN_ID, b64url, bytes32, concat, fromB64url, fromUtf8, randomBytes, sha3Hex, utf8, wipe } from "./util.js";

export const PURPOSE = {
  committee: "papertrail:committee:v1",
  share: "papertrail:share:v1",
  boardState: "papertrail:board-state:v1",
  script: "papertrail:script:v1",
  identity: "papertrail:identity:v1",
} as const;

export interface Participant {
  /** 0x address (role key). */
  address: `0x${string}`;
  recipient: SealRecipient;
}

export interface CentreSetup {
  centreId: `0x${string}`;
  /** nonce ‖ AES-GCM ciphertext of the variant (public blob). */
  cipher: Uint8Array;
  cipherHash: `0x${string}`;
  commitment: `0x${string}`;
  /** shares[i] is sealed to examiners[i]. */
  shares: [Uint8Array, Uint8Array, Uint8Array];
}

export interface ExamSetup {
  committeeEnvelope: Uint8Array;
  committeeBundleHash: `0x${string}`;
  masterCommitment: `0x${string}`;
  centres: CentreSetup[];
  minPairDistance: number;
  warning?: string;
}

interface CommitteeBundle {
  v: 1;
  examId: string;
  examSecret: string; // base64url
  paper: string; // the examiner-authored markdown
  centres: string[];
  tables: FingerprintTable[];
}

const shareAad = (examId: string, centreId: string, i: number) => concat(bytes32(examId), bytes32(centreId), new Uint8Array([i]));
const cipherAad = (examId: string, centreId: string, commitment: string) => concat(bytes32(examId), bytes32(centreId), bytes32(commitment));

export async function setExam(args: {
  paperMarkdown: string;
  examId: `0x${string}`;
  examiners: [Participant, Participant, Participant];
  board: Participant;
  centreIds: `0x${string}`[];
}): Promise<ExamSetup> {
  const paper = parsePaper(args.paperMarkdown);
  const examSecret = randomBytes(32);
  try {
    const copies: CopiesResult = generateCopies(paper, examSecret, args.centreIds);
    const bundle: CommitteeBundle = { v: 1, examId: args.examId, examSecret: b64url(examSecret), paper: args.paperMarkdown, centres: args.centreIds, tables: copies.tables };
    const bundleBytes = utf8(JSON.stringify(bundle));
    const committeeEnvelope = seal({
      chainId: CHAIN_ID, purpose: PURPOSE.committee, plaintext: bundleBytes, aad: bytes32(args.examId),
      recipients: [...args.examiners.map((e) => e.recipient), args.board.recipient],
    });
    wipe(bundleBytes);

    const centres: CentreSetup[] = [];
    for (const centreId of args.centreIds) {
      const copy = copies.centres[centreId];
      const kc = randomBytes(32);
      const nonce = randomBytes(12);
      const body = utf8(copy.text);
      const cipher = concat(nonce, gcm(kc, nonce, cipherAad(args.examId, centreId, copy.commitment)).encrypt(body));
      const parts = await shamirSplit(kc, 3, 2);
      const shares = parts.map((share, i) =>
        seal({ chainId: CHAIN_ID, purpose: PURPOSE.share, plaintext: share, aad: shareAad(args.examId, centreId, i), recipients: [args.examiners[i].recipient] }),
      ) as [Uint8Array, Uint8Array, Uint8Array];
      wipe(kc, body, ...parts);
      centres.push({ centreId, cipher, cipherHash: sha3Hex(cipher), commitment: copy.commitment, shares });
    }
    return {
      committeeEnvelope, committeeBundleHash: sha3Hex(committeeEnvelope), masterCommitment: copies.master.commitment, centres,
      minPairDistance: copies.minPairDistance, ...(copies.warning ? { warning: copies.warning } : {}),
    };
  } finally {
    wipe(examSecret);
  }
}

/** Committee member: open the bundle and re-derive every copy (master + centres). */
export function openCommitteeBundle(args: { envelope: Uint8Array; keys: SealKeyPair; examId: `0x${string}` }) {
  const pt = open({ chainId: CHAIN_ID, purpose: PURPOSE.committee, envelope: args.envelope, keys: args.keys, aad: bytes32(args.examId) });
  const bundle = JSON.parse(fromUtf8(pt)) as CommitteeBundle;
  wipe(pt);
  if (bundle.examId !== args.examId) throw new Error("committee bundle is for another exam");
  const paper = parsePaper(bundle.paper);
  const secret = fromB64url(bundle.examSecret);
  const copies = generateCopies(paper, secret, bundle.centres);
  wipe(secret);
  return { paper, tables: bundle.tables, copies };
}

/** Examiner: open their own share of K_c (spec §4.2 table, "papertrail:share:v1"). */
export function openShare(args: { envelope: Uint8Array; keys: SealKeyPair; examId: string; centreId: string; examinerIndex: number }): Uint8Array {
  return open({ chainId: CHAIN_ID, purpose: PURPOSE.share, envelope: args.envelope, keys: args.keys, aad: shareAad(args.examId, args.centreId, args.examinerIndex) });
}

export { cipherAad as _cipherAad };
