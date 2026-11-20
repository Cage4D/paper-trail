/**
 * pnpm deploy:papertrail — deploy PaperTrail.sol to qorechain-diana from the relayer.
 *
 * QoreChain: the relayer must have a registered ML-DSA-87 key and a LIVE EVM window that
 * is not narrowed by allowedTargets (a narrowed window refuses contract creation). Run
 * `forge build` in packages/contracts first. Writes scripts/out/deployment.json and
 * PAPERTRAIL_ADDRESS in .env. Refuses to redeploy when a deployment is already recorded
 * unless --force is given.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { evmWindowStatus } from "@qorechain/evm";
import { deployContract } from "@qorechain/evm";
import type { Abi, Hex } from "viem";
import { accountFor, writeEnv } from "./lib/env.js";
import { EXPLORER, REST, bigintJson, publicClient, walletFor } from "./lib/chain.js";

const OUT = new URL("./out/deployment.json", import.meta.url);
const ARTIFACT = new URL("../packages/contracts/out/PaperTrail.sol/PaperTrail.json", import.meta.url);
if (existsSync(OUT) && !process.argv.includes("--force")) {
  console.error(`already deployed: ${JSON.parse(readFileSync(OUT, "utf8")).address} (use --force to deploy again)`);
  process.exit(1);
}
const art = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
const relayer = await accountFor("relayer");
const w = await evmWindowStatus({ rest: REST, address: relayer.cosmos });
if (!w.found || !w.live || w.remainingTxs < 1n) throw new Error("relayer has no live EVM window; open one first");
if (w.allowedTargets?.length) throw new Error("the relayer window is narrowed by allowedTargets, which refuses contract creation");

const before = await publicClient.getBalance({ address: relayer.evm as Hex });
const hash = await deployContract(walletFor(relayer), { abi: art.abi, bytecode: art.bytecode.object });
console.log("deploy tx", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy failed: ${receipt.status}`);
const after = await publicClient.getBalance({ address: relayer.evm as Hex });
const rec = {
  network: "qorechain-diana", chainId: await publicClient.getChainId(), address: receipt.contractAddress,
  deployer: relayer.evm, tx: hash, block: receipt.blockNumber, gasUsed: receipt.gasUsed,
  effectiveGasPrice: receipt.effectiveGasPrice, costWei: before - after,
  explorer: `${EXPLORER}/tx/${hash}`, at: new Date().toISOString(),
};
writeFileSync(OUT, JSON.stringify(bigintJson(rec), null, 2) + "\n");
writeEnv({ PAPERTRAIL_ADDRESS: receipt.contractAddress });
console.log(JSON.stringify(bigintJson(rec)));
