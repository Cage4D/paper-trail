import { describe, expect, it } from "vitest";
import { buildMarksTree, markLeaf, verifyMarkProof } from "../src/merkle.js";
import { bindingMemo, bindingStatement, statementHash } from "../src/binding.js";
import { BoardGroups, centreGroupKey, groupChainId, markersGroupKey } from "../src/groups.js";
import { sealedToExactly } from "../src/release.js";
import { pseudonymHash, newPseudonym } from "../src/scripts.js";
import { CENTRE_A, EXAM_ID, cast } from "./fixtures.js";
import { sha3Hex, toHex, utf8 } from "../src/util.js";

describe("merkle: marks tree", () => {
  const entries = Array.from({ length: 7 }, (_, i) => ({ pseudonymHash: pseudonymHash(EXAM_ID, newPseudonym()), score: 40 + i }));
  const tree = buildMarksTree(entries);
  it("every entry proves against the root; tampered scores or proofs fail", () => {
    for (const e of entries) {
      const p = tree.proof(e.pseudonymHash);
      expect(verifyMarkProof(tree.root, e, p)).toBe(true);
      expect(verifyMarkProof(tree.root, { ...e, score: e.score + 1 }, p)).toBe(false);
      if (p.length) expect(verifyMarkProof(tree.root, e, [toHex(new Uint8Array(32)), ...p.slice(1)])).toBe(false);
    }
  });
  it("root is independent of input order; single entry and duplicates", () => {
    expect(buildMarksTree([...entries].reverse()).root).toBe(tree.root);
    const one = buildMarksTree([entries[0]]);
    expect(one.root).toBe(toHex(markLeaf(entries[0])));
    expect(verifyMarkProof(one.root, entries[0], one.proof(entries[0].pseudonymHash))).toBe(true);
    expect(() => buildMarksTree([entries[0], entries[0]])).toThrow(/duplicate/);
  });
});

describe("binding statement", () => {
  it("is deterministic and names role, QoreX address, nonce and tx", () => {
    const s = bindingStatement({ roleAddress: "qor1role", qorexAddress: "qor1qorex", nonce: "abc12345", txHash: "deadbeef" });
    expect(s).toContain("tx: DEADBEEF");
    expect(statementHash(s)).toBe(sha3Hex(utf8(s)));
    expect(bindingMemo("abc12345")).toBe("papertrail-bind:abc12345");
  });
});

describe("groups: chain ids and envelope recipients", () => {
  it("a centre group's chain id is its centreId; a markers group's is a hash of its key", () => {
    expect(groupChainId(centreGroupKey(CENTRE_A))).toBe(CENTRE_A);
    expect(groupChainId(markersGroupKey(EXAM_ID))).toBe(sha3Hex(utf8(`papertrail:markers:${EXAM_ID}`)));
  });
  it("sealedToExactly checks a rotation envelope against the member list", () => {
    const bg = new BoardGroups();
    const [i1, i2, i3] = cast.inv;
    const r = bg.create(centreGroupKey(CENTRE_A), { [i1.evm]: i1.recipient, [i2.evm]: i2.recipient });
    expect(sealedToExactly(r.envelope!, [i1.seal.mlkemPublicKey, i2.seal.mlkemPublicKey])).toBe(true);
    expect(sealedToExactly(r.envelope!, [i1.seal.mlkemPublicKey])).toBe(false);
    expect(sealedToExactly(r.envelope!, [i1.seal.mlkemPublicKey, i3.seal.mlkemPublicKey])).toBe(false);
  });
});
