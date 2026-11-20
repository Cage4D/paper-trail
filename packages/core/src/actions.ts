/**
 * Signed actions (spec §4.4) — the client side of PaperTrail's `_auth`.
 *
 *   digest      = keccak256(abi.encode(DOMAIN, chainId, contract, uint8(action), signer, nonce, payloadHash))
 *   DOMAIN      = keccak256("PaperTrail.v1")
 *   payloadHash = keccak256(abi.encode(<action fields in calldata order>))   (PaperTrailLib)
 *   examId      = keccak256(abi.encode(board, salt))                         (PaperTrail.examIdFor)
 *
 * QoreChain: the role holder signs the 32-byte digest with ML-DSA-87, pure mode, EMPTY
 * context (FIPS 204). The `pqcVerify` precompile checks exactly those bytes (findings Q3).
 * Byte-for-byte equality with Solidity is pinned by packages/contracts/test/vectors.
 */
import { encodeAbiParameters, keccak256, toHex as vToHex, type Hex } from "viem";
import { pqSign } from "@qorechain/qoresign";
import { bytes32 } from "./util.js";

export const DOMAIN: Hex = keccak256(vToHex("PaperTrail.v1"));

/** Same order as PaperTrailLib.Action (never reordered). */
export enum Action {
  CreateExam = 0,
  SetCentre = 1,
  RotateEpoch = 2,
  Release = 3,
  SubmitScript = 4,
  PublishMarks = 5,
  BindIdentity = 6,
}

export interface ActionFields {
  [Action.CreateExam]: { salt: Hex; board: Hex; examiners: [Hex, Hex, Hex]; startTime: bigint | number; masterCommitment: Hex; committeeBundleHash: Hex };
  [Action.SetCentre]: { examId: Hex; centreId: Hex; commitment: Hex; cipherHash: Hex };
  [Action.RotateEpoch]: { centreId: Hex; board: Hex; epoch: bigint | number; membersHash: Hex; envelopeHash: Hex };
  [Action.Release]: { examId: Hex; centreId: Hex; blobHash: Hex; examiner: Hex };
  [Action.SubmitScript]: { examId: Hex; centreId: Hex; pseudonymHash: Hex; scriptHash: Hex; markerEpoch: bigint | number };
  [Action.PublishMarks]: { examId: Hex; merkleRoot: Hex };
  [Action.BindIdentity]: { role: Hex; statementHash: Hex };
}

const enc = (types: string[], values: unknown[]) => encodeAbiParameters(types.map((type) => ({ type })), values as never);

/** ABI types and argument order of each action's payload (= PaperTrailLib). */
const LAYOUT: { [A in Action]: { types: string[]; order: (keyof ActionFields[A])[] } } = {
  [Action.CreateExam]: { types: ["bytes32", "address", "address[3]", "uint64", "bytes32", "bytes32"], order: ["salt", "board", "examiners", "startTime", "masterCommitment", "committeeBundleHash"] },
  [Action.SetCentre]: { types: ["bytes32", "bytes32", "bytes32", "bytes32"], order: ["examId", "centreId", "commitment", "cipherHash"] },
  [Action.RotateEpoch]: { types: ["bytes32", "address", "uint64", "bytes32", "bytes32"], order: ["centreId", "board", "epoch", "membersHash", "envelopeHash"] },
  [Action.Release]: { types: ["bytes32", "bytes32", "bytes32", "address"], order: ["examId", "centreId", "blobHash", "examiner"] },
  [Action.SubmitScript]: { types: ["bytes32", "bytes32", "bytes32", "bytes32", "uint64"], order: ["examId", "centreId", "pseudonymHash", "scriptHash", "markerEpoch"] },
  [Action.PublishMarks]: { types: ["bytes32", "bytes32"], order: ["examId", "merkleRoot"] },
  [Action.BindIdentity]: { types: ["address", "bytes32"], order: ["role", "statementHash"] },
};

/** The payload's values in contract-call order (the action function's arguments before the signature). */
export function payloadArgs<A extends Action>(action: A, fields: ActionFields[A]): unknown[] {
  return LAYOUT[action].order.map((k) => {
    const v = fields[k] as unknown;
    return typeof v === "number" ? BigInt(v) : v;
  });
}

export function payloadHash<A extends Action>(action: A, fields: ActionFields[A]): Hex {
  return keccak256(enc(LAYOUT[action].types, payloadArgs(action, fields)));
}

export interface DigestInput {
  chainId: bigint | number;
  contract: Hex;
  action: Action;
  signer: Hex;
  nonce: bigint | number;
  payloadHash: Hex;
}

export function digestOf(d: DigestInput): Hex {
  return keccak256(
    enc(["bytes32", "uint256", "address", "uint8", "address", "uint256", "bytes32"], [DOMAIN, BigInt(d.chainId), d.contract, d.action, d.signer, BigInt(d.nonce), d.payloadHash]),
  );
}

export function examIdFor(board: Hex, salt: Hex): Hex {
  return keccak256(enc(["address", "bytes32"], [board, salt]));
}

/** Payload hash + digest for an action, ready to sign. */
export function buildAction<A extends Action>(action: A, fields: ActionFields[A], ctx: Omit<DigestInput, "action" | "payloadHash">) {
  const ph = payloadHash(action, fields);
  return { action, fields, args: payloadArgs(action, fields), payloadHash: ph, digest: digestOf({ ...ctx, action, payloadHash: ph }) };
}

/** ML-DSA-87 signature (4,627 bytes) over the 32-byte digest, pure mode, empty context. */
export function signAction(pqSecretKey: Uint8Array, digest: Hex): Uint8Array {
  return pqSign(pqSecretKey, bytes32(digest));
}
