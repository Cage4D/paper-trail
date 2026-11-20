import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pqVerify } from "@qorechain/qoresign";
import { Action, DOMAIN, buildAction, digestOf, examIdFor, payloadHash, signAction, type ActionFields } from "../src/actions.js";
import { roleKeyFromMnemonic } from "../src/keys.js";
import { bytes32 } from "../src/util.js";

// The vectors Foundry checks PaperTrailLib against (generated independently with viem).
const V = JSON.parse(readFileSync(new URL("../../contracts/test/vectors/digest-vectors.json", import.meta.url), "utf8"));
const NAME: Record<string, Action> = {
  CreateExam: Action.CreateExam, SetCentre: Action.SetCentre, RotateEpoch: Action.RotateEpoch, Release: Action.Release,
  SubmitScript: Action.SubmitScript, PublishMarks: Action.PublishMarks, BindIdentity: Action.BindIdentity,
};

describe("actions: digest matches Solidity byte for byte (shared vectors)", () => {
  it("domain", () => expect(DOMAIN).toBe(V.domain));
  for (const [name, vec] of Object.entries<Record<string, unknown>>(V.vectors)) {
    it(name, () => {
      const action = NAME[name];
      expect(vec.action).toBe(action);
      const ph = payloadHash(action, vec.fields as ActionFields[typeof action]);
      expect(ph).toBe(vec.payloadHash);
      expect(digestOf({ chainId: V.chainId, contract: V.contract, action, signer: vec.signer as `0x${string}`, nonce: V.nonce, payloadHash: ph })).toBe(vec.digest);
    });
  }
  it("examIdFor(board, salt) is the examId used by the later vectors", () => {
    const c = V.vectors.CreateExam.fields;
    expect(examIdFor(c.board, c.salt)).toBe(V.vectors.SetCentre.fields.examId);
  });
});

describe("actions: matches the deployed contract on diana", () => {
  it("examIdFor equals PaperTrail.examIdFor read via cast call in Phase 2", () => {
    // cast call 0xDd26…4C33 "examIdFor(address,bytes32)(bytes32)" <board> 0x…01
    expect(examIdFor("0x156e64214f91CE029959325013f2226f095A139B", `0x${"00".repeat(31)}01`)).toBe(
      "0xfe5c97658066a0f9969c876fe4b5f46b5636cbef612fc1a48085960947608d7d",
    );
  });
});

describe("actions: signing", () => {
  const role = roleKeyFromMnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
  it("signAction produces a 4,627-byte ML-DSA-87 signature over the raw digest", () => {
    const a = buildAction(Action.BindIdentity, { role: role.evm, statementHash: `0x${"11".repeat(32)}` }, { chainId: 9800, contract: "0xDd26128846Ea6A35340010ce8be8F5820E264C33", signer: role.evm, nonce: 0 });
    const sig = signAction(role.pq.secretKey, a.digest);
    expect(sig.length).toBe(4627);
    expect(pqVerify(role.pq.publicKey, bytes32(a.digest), sig)).toBe(true);
    expect(a.args).toEqual([role.evm, `0x${"11".repeat(32)}`]);
  });
});
