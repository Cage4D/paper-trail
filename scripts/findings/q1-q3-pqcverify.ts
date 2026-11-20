/**
 * Findings Q1 + Q3 — QoreChain `pqcVerify` precompile (0x…0A01) on diana.
 *
 * Read-only: only eth_call / eth_estimateGas against the public testnet EVM RPC
 * plus one REST read (fetchEvmLimits). No funds, no keys from .env.
 *
 * Q1: does pqcVerify take ML-DSA-87-sized input (pk 2592 B, sig 4627 B), what is the
 *     precompile input cap (precompile_input_max_bytes) and what does a call cost?
 * Q3: which ML-DSA variant does it verify: FIPS-204 pure ML-DSA with empty context?
 *     a non-empty context? HashML-DSA (pre-hash)? Does it hash the message itself?
 *
 * Run: pnpm tsx scripts/findings/q1-q3-pqcverify.ts  (writes out/q1-q3.json)
 */
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createPublicClient, encodeFunctionData, getAddress, http, keccak256, toHex, type Hex } from "viem";
import { IQORE_PQC_ABI, PRECOMPILE_ADDRESSES } from "@qorechain/evm";
import { fetchEvmLimits, getNetwork } from "@qorechain/sdk";
import { pqKeyFromSeed, pqSign, ALGORITHM_ML_DSA_87 } from "@qorechain/qoresign";
import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { sha512 } from "@noble/hashes/sha2.js";

const net = getNetwork("testnet");
const REST = process.env.QORE_REST || net.endpoints.rest;
const EVM_RPC = process.env.EVM_RPC || "https://evm-testnet.qore.host";
const client = createPublicClient({ transport: http(EVM_RPC) });
// NOTE: @qorechain/evm exports "0x…0A01" (upper-case A, not EIP-55), which viem's
// strict address check rejects ("Address … is invalid"). getAddress() normalises it
// to the checksummed form "0x…0a01". Same issue for Solidity literals (see findings).
const PQC = getAddress(PRECOMPILE_ADDRESSES.pqcVerify);
out_checksum: {
  const raw = PRECOMPILE_ADDRESSES.pqcVerify;
  console.log("kit constant", raw, "-> checksummed", PQC);
}
// Any address works for eth_call / estimateGas; this one is a throwaway, unfunded.
const FROM = "0x000000000000000000000000000000000000dEaD" as const;

const out: Record<string, unknown> = { evmRpc: EVM_RPC, rest: REST, at: new Date().toISOString() };
const enc = new TextEncoder();

async function verify(label: string, pk: Uint8Array, sig: Uint8Array, msg: Uint8Array) {
  const data = encodeFunctionData({ abi: IQORE_PQC_ABI, functionName: "pqcVerify", args: [toHex(pk), toHex(sig), toHex(msg)] });
  const row: Record<string, unknown> = { label, pk: pk.length, sig: sig.length, msg: msg.length, calldataBytes: (data.length - 2) / 2 };
  try {
    const res = await client.call({ to: PQC, data, account: FROM });
    row.raw = res.data ?? "0x";
    row.valid = res.data && res.data !== "0x" ? BigInt(res.data) === 1n : null;
  } catch (e) {
    row.callError = (e as Error).message.split("\n")[0];
  }
  try {
    row.estimateGas = (await client.estimateGas({ to: PQC, data, account: FROM })).toString();
  } catch (e) {
    row.gasError = (e as Error).message.split("\n")[0];
  }
  console.log(JSON.stringify(row));
  return row;
}

// Intrinsic gas of a plain tx carrying this calldata (21000 + 4/zero byte + 16/non-zero byte),
// so precompile gas ≈ estimateGas − intrinsic. (EIP-7623 floor not applied; noted in findings.)
function intrinsic(dataHex: Hex): number {
  const b = Buffer.from(dataHex.slice(2), "hex");
  let g = 21000;
  for (const x of b) g += x === 0 ? 4 : 16;
  return g;
}

const limits = await fetchEvmLimits({ rest: REST });
out.evmLimits = { txMaxGas: limits.txMaxGas.toString(), precompileInputMaxBytes: limits.precompileInputMaxBytes.toString() };
console.log("evm_limits", out.evmLimits);
out.algorithmIdConstants = { "qoresign.ALGORITHM_ML_DSA_87": ALGORITHM_ML_DSA_87 };

const kp = pqKeyFromSeed(randomBytes(32));
const other = pqKeyFromSeed(randomBytes(32));
const digest = new Uint8Array(Buffer.from(keccak256(enc.encode("PaperTrail findings Q1/Q3")).slice(2), "hex"));
const sigPure = pqSign(kp.secretKey, digest); // kit default: pure ML-DSA, empty ctx, deterministic
const rows: Record<string, unknown>[] = [];

// Q1 / Q3 core: pure ML-DSA-87, empty context, 32-byte digest (spec §4.4 shape)
rows.push(await verify("pure, ctx='', 32B digest (kit pqSign)", kp.publicKey, sigPure, digest));
rows.push(await verify("pure, hedged signature", kp.publicKey, ml_dsa87.sign(digest, kp.secretKey), digest));
// negatives
const bad = sigPure.slice(); bad[100] ^= 1;
rows.push(await verify("tampered signature", kp.publicKey, bad, digest));
rows.push(await verify("wrong public key", other.publicKey, sigPure, digest));
const d2 = digest.slice(); d2[0] ^= 1;
rows.push(await verify("wrong message", kp.publicKey, sigPure, d2));
// Q3: context string
rows.push(await verify("pure, ctx='PaperTrail.v1'", kp.publicKey, ml_dsa87.sign(digest, kp.secretKey, { context: enc.encode("PaperTrail.v1"), extraEntropy: false }), digest));
// Q3: HashML-DSA (pre-hash with SHA-512) over the same message
rows.push(await verify("HashML-DSA(SHA-512), ctx=''", kp.publicKey, ml_dsa87.prehash(sha512).sign(digest, kp.secretKey, { extraEntropy: false }), digest));
// Q3: does the precompile hash the message itself? Sign a long raw message.
const longMsg = enc.encode("x".repeat(300));
const sigLong = pqSign(kp.secretKey, longMsg);
rows.push(await verify("raw 300B message, signed raw", kp.publicKey, sigLong, longMsg));
const kLong = new Uint8Array(Buffer.from(keccak256(longMsg).slice(2), "hex"));
rows.push(await verify("signed raw 300B, passed keccak(msg)", kp.publicKey, sigLong, kLong));
rows.push(await verify("signed keccak(msg), passed raw msg", kp.publicKey, pqSign(kp.secretKey, kLong), longMsg));
// Q1: input-size sweep (message grows; pk+sig fixed at ML-DSA-87 sizes)
for (const n of [1024, 2048, 4096, 8192, 16384]) {
  const m = randomBytes(n);
  rows.push(await verify(`size sweep: msg ${n}B`, kp.publicKey, pqSign(kp.secretKey, m), m));
}
// precompile gas estimate for the main case
const mainData = encodeFunctionData({ abi: IQORE_PQC_ABI, functionName: "pqcVerify", args: [toHex(kp.publicKey), toHex(sigPure), toHex(digest)] });
out.mainCase = { calldataBytes: (mainData.length - 2) / 2, intrinsicGas: intrinsic(mainData), estimateGas: rows[0].estimateGas };
out.rows = rows;
writeFileSync(new URL("./out/q1-q3.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("main case", out.mainCase);
