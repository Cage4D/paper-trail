/**
 * Marks Merkle tree (spec §7.3 publishMarks / marks proof).
 *
 *   leaf  = SHA3-256("papertrail:mark:v1" ‖ pseudonymHash(32) ‖ u32 score)
 *   node  = SHA3-256(min(a,b) ‖ max(a,b))      (sorted pairs: proofs need no left/right flags)
 *   odd   = the last node is carried up unchanged
 * The board computes the root on its client and signs publishMarks(examId, root); the API
 * recomputes it from the stored marks before relaying. A candidate verifies their proof
 * against the on-chain root.
 */
import { bytes32, concat, sha3, toHex, utf8 } from "./util.js";

export interface MarkEntry {
  pseudonymHash: `0x${string}`;
  score: number;
}

const LEAF_TAG = utf8("papertrail:mark:v1");
function u32(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error("score must be a uint32");
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}
const cmp = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
const pair = (a: Uint8Array, b: Uint8Array) => sha3(cmp(a, b) <= 0 ? concat(a, b) : concat(b, a));

export function markLeaf(e: MarkEntry): Uint8Array {
  return sha3(concat(LEAF_TAG, bytes32(e.pseudonymHash), u32(e.score)));
}

export function buildMarksTree(entries: MarkEntry[]) {
  if (!entries.length) throw new Error("no marks");
  const seen = new Set<string>();
  for (const e of entries) {
    const k = e.pseudonymHash.toLowerCase();
    if (seen.has(k)) throw new Error("duplicate pseudonym in marks");
    seen.add(k);
  }
  // canonical leaf order: by leaf bytes
  const leaves = entries.map((e) => ({ e, leaf: markLeaf(e) })).sort((a, b) => cmp(a.leaf, b.leaf));
  const levels: Uint8Array[][] = [leaves.map((l) => l.leaf)];
  while (levels[levels.length - 1].length > 1) {
    const cur = levels[levels.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? pair(cur[i], cur[i + 1]) : cur[i]);
    levels.push(next);
  }
  const root = toHex(levels[levels.length - 1][0]);
  const proof = (pseudonymHash: string): `0x${string}`[] => {
    let idx = leaves.findIndex((l) => l.e.pseudonymHash.toLowerCase() === pseudonymHash.toLowerCase());
    if (idx < 0) throw new Error("pseudonym not in the marks");
    const out: `0x${string}`[] = [];
    for (let lv = 0; lv < levels.length - 1; lv++) {
      const sib = idx ^ 1;
      if (sib < levels[lv].length) out.push(toHex(levels[lv][sib]));
      idx >>= 1;
    }
    return out;
  };
  return { root, proof, leaves: leaves.map((l) => l.e) };
}

export function verifyMarkProof(root: string, entry: MarkEntry, proof: string[]): boolean {
  let h = markLeaf(entry);
  for (const p of proof) h = pair(h, bytes32(p));
  return toHex(h) === root.toLowerCase();
}
