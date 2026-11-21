/**
 * Phase 2 evidence: the REAL pqcVerify, called from inside PaperTrail on diana, rejects a
 * forged signature and accepts the genuine one. Uses the exam from scripts/out/smoke.json;
 * examiner3 (has not released) signs a release for centre A with ML-DSA-87.
 * Simulation only (eth_call), nothing is sent. Writes out/live-negative.json.
 * Release payload includes the signed epoch (bug-hunt finding 1); smoke.json's exam is at epoch 1.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BaseError, ContractFunctionRevertedError, encodeAbiParameters, getAddress, keccak256, toHex, type Abi, type Hex } from "viem";
import { pqSign } from "@qorechain/qoresign";
import { accountFor } from "../lib/env.js";
import { publicClient } from "../lib/chain.js";

const smoke = JSON.parse(readFileSync(new URL("../out/smoke.json", import.meta.url), "utf8"));
const ADDRESS = getAddress(smoke.contract);
const ABI = (JSON.parse(readFileSync(new URL("../../packages/contracts/out/PaperTrail.sol/PaperTrail.json", import.meta.url), "utf8")) as { abi: Abi }).abi;
const relayer = await accountFor("relayer");
const ex3 = await accountFor("examiner3");
const enc = (t: string[], v: unknown[]) => encodeAbiParameters(t.map((type) => ({ type })), v as never);
// centre A id as derived in smoke.ts from the createExam salt is not stored; read it from the setCentre log
const setA = await publicClient.getTransactionReceipt({ hash: smoke.steps.find((s: { step: string }) => s.step === "setCentre A").tx });
const centreA = setA.logs[0].topics[2] as Hex;
const blob = keccak256(toHex("live-negative:blob"));
const EPOCH = 1n;
const ph = keccak256(enc(["bytes32", "bytes32", "bytes32", "address", "uint64"], [smoke.examId, centreA, blob, ex3.evm, EPOCH]));
const digest = (await publicClient.readContract({ address: ADDRESS, abi: ABI, functionName: "nextDigest", args: [3, ex3.evm, ph] })) as Hex;
const good = pqSign(ex3.pqc.secretKey, Buffer.from(digest.slice(2), "hex"));
const bad = good.slice(); bad[1000] ^= 0x01;

async function sim(label: string, sig: Uint8Array) {
  try {
    const { request } = await publicClient.simulateContract({ address: ADDRESS, abi: ABI, functionName: "release",
      args: [smoke.examId, centreA, blob, ex3.evm, EPOCH, toHex(sig)], account: relayer.evm as Hex });
    const gas = await publicClient.estimateGas({ ...request, account: relayer.evm as Hex, to: ADDRESS, data: (await import("viem")).encodeFunctionData({ abi: ABI, functionName: "release", args: request.args }) });
    return { label, ok: true, estimateGas: gas.toString() };
  } catch (e) {
    const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    return { label, ok: false, revert: rev instanceof ContractFunctionRevertedError ? rev.data?.errorName : (e as Error).message.split("\n")[0] };
  }
}
const rows = [await sim("examiner3 genuine ML-DSA-87 signature", good), await sim("same signature, 1 byte flipped", bad)];
for (const r of rows) console.log(JSON.stringify(r));
writeFileSync(new URL("./out/live-negative.json", import.meta.url), JSON.stringify({ contract: ADDRESS, examId: smoke.examId, centreA, rows }, null, 2) + "\n");
