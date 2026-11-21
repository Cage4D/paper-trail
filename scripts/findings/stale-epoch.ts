/**
 * Bug-hunt finding 1, live: on the exam from scripts/out/full-e2e.json, centre A's group is at
 * epoch 2 (invigilator A2 removed). examiner2 has not released centre A. A release signed for
 * epoch 1 (sealed before the removal) must be refused by the real contract (BadEpoch(2)); the
 * same release signed for epoch 2 must pass. Simulation only (eth_call); nothing is sent.
 * Writes scripts/findings/out/stale-epoch.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BaseError, ContractFunctionRevertedError, createPublicClient, getAddress, http, type Hex } from "viem";
import { PAPERTRAIL_ABI } from "../../packages/shared/src/abi.js";
import { Action, buildAction, roleKeyFromMnemonic, signAction, toHex } from "../../packages/core/src/index.js";
import { mnemonicFor } from "../lib/env.js";
import { EVM_RPC } from "../lib/chain.js";

const e2e = JSON.parse(readFileSync(new URL("../out/full-e2e.json", import.meta.url), "utf8"));
const C = getAddress(e2e.contract);
const client = createPublicClient({ transport: http(EVM_RPC) });
const ex2 = roleKeyFromMnemonic(mnemonicFor("examiner2"));
const relayer = roleKeyFromMnemonic(mnemonicFor("relayer"));
const examId = e2e.examId as Hex;
const A = e2e.centres.A as Hex;
const blob = `0x${"11".repeat(32)}` as Hex;
const nonce = (await client.readContract({ address: C, abi: PAPERTRAIL_ABI, functionName: "nonces", args: [ex2.evm] })) as bigint;
const rows: { signedEpoch: string; result: string }[] = [];
for (const epoch of [1n, 2n]) {
  const sig = toHex(signAction(ex2.pq.secretKey, buildAction(Action.Release, { examId, centreId: A, blobHash: blob, examiner: ex2.evm, epoch }, { chainId: 9800, contract: C, signer: ex2.evm, nonce }).digest));
  let result: string;
  try {
    await client.simulateContract({ address: C, abi: PAPERTRAIL_ABI, functionName: "release", args: [examId, A, blob, ex2.evm, epoch, sig], account: relayer.evm });
    result = "accepted";
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    result = r instanceof ContractFunctionRevertedError ? `reverted ${r.data?.errorName}(${r.data?.args?.map(String).join(",") ?? ""})` : `error: ${(e as Error).message.split("\n")[0]}`;
  }
  rows.push({ signedEpoch: epoch.toString(), result });
  console.log(`release signed for epoch ${epoch}: ${result}`);
}
writeFileSync(new URL("./out/stale-epoch.json", import.meta.url), JSON.stringify({ contract: C, examId, centreId: A, rows }, null, 2) + "\n");
