/**
 * pnpm smoke — Phase 2 live smoke test of PaperTrail on qorechain-diana.
 *
 * Real ML-DSA-87 signatures by the role keys (pure ML-DSA, empty context, over the
 * 32-byte digest), checked on-chain by the real `pqcKeyStatus` and `pqcVerify`
 * precompiles. The relayer submits every tx; it signs nothing that authorises an action.
 *
 *   createExam → setCentre ×2 → rotateEpoch → early release (simulated: must revert
 *   TooEarly; no tx sent) → wait for startTime → release ×2 → Released
 *
 * For each action: compute the digest locally, check it against the contract's
 * nextDigest view, sign, simulate (eth_call, the relayer's "verify first"), then send.
 * Writes scripts/out/smoke.json (tx hashes, gas, explorer links). Read-only for secrets.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  BaseError, ContractFunctionRevertedError, encodeAbiParameters, getAddress, keccak256, toHex,
  type Abi, type Hex,
} from "viem";
import { pqSign } from "@qorechain/qoresign";
import { IQORE_PQC_ABI, PRECOMPILE_ADDRESSES } from "@qorechain/evm";
import { accountFor, type Role } from "./lib/env.js";
import { EXPLORER, bigintJson, publicClient, walletFor } from "./lib/chain.js";

const ADDRESS = getAddress(process.env.PAPERTRAIL_ADDRESS!.trim());
const ABI = (JSON.parse(readFileSync(new URL("../packages/contracts/out/PaperTrail.sol/PaperTrail.json", import.meta.url), "utf8")) as { abi: Abi }).abi;
const DOMAIN = keccak256(toHex("PaperTrail.v1"));
const ACTION = { CreateExam: 0, SetCentre: 1, RotateEpoch: 2, Release: 3 } as const;
const enc = (types: string[], values: unknown[]) => encodeAbiParameters(types.map((type) => ({ type })), values as never);
const h = (s: string) => keccak256(toHex(s));

const acct = Object.fromEntries(await Promise.all((["relayer", "board", "examiner1", "examiner2", "examiner3"] as Role[]).map(async (r) => [r, await accountFor(r)])));
const relayerWallet = walletFor(acct.relayer);
const chainId = BigInt(await publicClient.getChainId());
const log: Record<string, unknown> = { contract: ADDRESS, chainId: Number(chainId), steps: [] as unknown[] };
const steps = log.steps as Record<string, unknown>[];

async function signAction(role: Role, action: number, payloadHash: Hex): Promise<Hex> {
  const signer = acct[role].evm as Hex;
  const nonce = (await publicClient.readContract({ address: ADDRESS, abi: ABI, functionName: "nonces", args: [signer] })) as bigint;
  const digest = keccak256(enc(["bytes32", "uint256", "address", "uint8", "address", "uint256", "bytes32"], [DOMAIN, chainId, ADDRESS, action, signer, nonce, payloadHash]));
  const onchain = await publicClient.readContract({ address: ADDRESS, abi: ABI, functionName: "nextDigest", args: [action, signer, payloadHash] });
  if (onchain !== digest) throw new Error(`digest mismatch for ${role}: local ${digest} vs contract ${onchain}`);
  // QoreChain: ML-DSA-87 (FIPS 204) pure mode, empty context, over the raw 32-byte digest.
  return toHex(pqSign(acct[role].pqc.secretKey, Buffer.from(digest.slice(2), "hex")));
}

async function send(step: string, functionName: string, args: unknown[]) {
  const { request, result } = await publicClient.simulateContract({ address: ADDRESS, abi: ABI, functionName, args, account: relayerWallet.account });
  const hash = await relayerWallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${step} reverted on-chain (${hash})`);
  const row = { step, tx: hash, block: receipt.blockNumber, gasUsed: receipt.gasUsed, events: receipt.logs.length, explorer: `${EXPLORER}/tx/${hash}` };
  steps.push(bigintJson(row));
  console.log(JSON.stringify(bigintJson(row)));
  return { receipt, result };
}

// 0. reference: cost of the precompiles on their own (top-level eth_estimateGas)
log.precompileGas = {
  pqcKeyStatus: (await publicClient.estimateGas({ to: getAddress(PRECOMPILE_ADDRESSES.pqcKeyStatus), account: acct.relayer.evm as Hex,
    data: (await import("viem")).encodeFunctionData({ abi: IQORE_PQC_ABI, functionName: "pqcKeyStatus", args: [acct.board.evm as Hex] }) })).toString(),
};

// 1. createExam (board-signed). startTime from chain time, leaving room for the setup txs.
const latest = await publicClient.getBlock();
const startTime = latest.timestamp + 150n;
const salt = toHex(randomBytes(32));
const examiners = [acct.examiner1.evm, acct.examiner2.evm, acct.examiner3.evm] as Hex[];
const master = h(`smoke:master:${salt}`);
const bundle = h(`smoke:bundle:${salt}`);
const createPayload = keccak256(enc(["bytes32", "address", "address[3]", "uint64", "bytes32", "bytes32"], [salt, acct.board.evm, examiners, startTime, master, bundle]));
const created = await send("createExam", "createExam", [salt, acct.board.evm, examiners, startTime, master, bundle, await signAction("board", ACTION.CreateExam, createPayload)]);
const examId = created.result as Hex;
log.examId = examId;
log.startTime = Number(startTime);

// 2. setCentre ×2 (board-signed)
const centres = { A: h(`smoke:centre-A:${salt}`), B: h(`smoke:centre-B:${salt}`) };
for (const [name, centreId] of Object.entries(centres)) {
  const c = h(`smoke:commitment:${name}`), x = h(`smoke:cipher:${name}`);
  const ph = keccak256(enc(["bytes32", "bytes32", "bytes32", "bytes32"], [examId, centreId, c, x]));
  await send(`setCentre ${name}`, "setCentre", [examId, centreId, c, x, await signAction("board", ACTION.SetCentre, ph)]);
}

// 3. rotateEpoch: the board's group for centre A → epoch 1
{
  const mh = h("smoke:members:A:1"), eh = h("smoke:envelope:A:1");
  const ph = keccak256(enc(["bytes32", "address", "uint64", "bytes32", "bytes32"], [centres.A, acct.board.evm, 1n, mh, eh]));
  await send("rotateEpoch A→1", "rotateEpoch", [centres.A, acct.board.evm, 1n, mh, eh, await signAction("board", ACTION.RotateEpoch, ph)]);
}

// 4. early release: must revert TooEarly. Simulated only (a real failing tx would just burn a window slot).
async function releaseArgs(role: Role) {
  const blob = h(`smoke:blob:${role}`);
  // the release signs the group epoch it was sealed for (centre A's group is at epoch 1 here)
  const ph = keccak256(enc(["bytes32", "bytes32", "bytes32", "address", "uint64"], [examId, centres.A, blob, acct[role].evm, 1n]));
  return [examId, centres.A, blob, acct[role].evm, 1n, await signAction(role, ACTION.Release, ph)];
}
try {
  await publicClient.simulateContract({ address: ADDRESS, abi: ABI, functionName: "release", args: await releaseArgs("examiner1"), account: relayerWallet.account });
  throw new Error("early release did NOT revert");
} catch (e) {
  const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
  const name = rev instanceof ContractFunctionRevertedError ? rev.data?.errorName : undefined;
  if (name !== "TooEarly") throw e;
  const row = { step: "early release (simulated)", reverted: name, args: (rev as ContractFunctionRevertedError).data?.args?.map(String) };
  steps.push(row);
  console.log(JSON.stringify(row));
}

// 5. wait for startTime (chain time), then two releases → Released
for (;;) {
  const b = await publicClient.getBlock();
  if (b.timestamp >= startTime) break;
  await new Promise((r) => setTimeout(r, 3000));
}
await send("release examiner1", "release", await releaseArgs("examiner1"));
const second = await send("release examiner2", "release", await releaseArgs("examiner2"));
const releasedTopic = keccak256(toHex("Released(bytes32,bytes32,uint64)"));
const released = second.receipt.logs.filter((l) => l.address.toLowerCase() === ADDRESS.toLowerCase() && l.topics[0] === releasedTopic);
log.releasedEvents = released.length;
log.releasedCentre = await publicClient.readContract({ address: ADDRESS, abi: ABI, functionName: "releasedCentre", args: [examId, centres.A] });
console.log(JSON.stringify({ releasedEvents: log.releasedEvents, releasedCentre: log.releasedCentre }));
if (released.length !== 1 || log.releasedCentre !== true) throw new Error("Released was not emitted exactly once");
writeFileSync(new URL("./out/smoke.json", import.meta.url), JSON.stringify(bigintJson(log), null, 2) + "\n");
console.log("smoke test passed");
