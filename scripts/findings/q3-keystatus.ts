/**
 * Findings Q3/Q4/Q6 follow-up — read the registered keys of our accounts the way the
 * contract and the clients will:
 *  - EVM precompile `pqcKeyStatus(address)` at 0x…0a02 (eth_call): registered, algorithmId, pubkey length
 *  - pubkey from the precompile equals the locally derived ML-DSA-87 key
 *  - QoreSeal `fetchKemKey` (REST /qorechain/pqc/v1/kem/{addr}) equals the account's sealing key
 *  - the relayer's EVM window (`evmWindowStatus`)
 * Read-only. Writes scripts/findings/out/q3-keystatus.json.
 */
import { writeFileSync } from "node:fs";
import { createPublicClient, getAddress, http } from "viem";
import { IQORE_PQC_ABI, PRECOMPILE_ADDRESSES, evmWindowStatus } from "@qorechain/evm";
import { getNetwork } from "@qorechain/sdk";
import { deriveSealKeys } from "@qorechain/qoreseal";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import { accountFor, mnemonicFor, type Role } from "../lib/env.js";

const net = getNetwork("testnet");
const REST = process.env.QORE_REST?.trim() || net.endpoints.rest;
const client = createPublicClient({ transport: http(process.env.EVM_RPC || "https://evm-testnet.qore.host") });
const STATUS = getAddress(PRECOMPILE_ADDRESSES.pqcKeyStatus);
const out: Record<string, unknown> = { at: new Date().toISOString() };

for (const role of ["relayer", "board", "examiner1", "examiner2", "examiner3"] as Role[]) {
  const a = await accountFor(role);
  const [registered, algorithmId, pubkey] = await client.readContract({ address: STATUS, abi: IQORE_PQC_ABI, functionName: "pqcKeyStatus", args: [a.evm as `0x${string}`] });
  const pk = Buffer.from(pubkey.slice(2), "hex");
  const kem = await fetchKemKey({ rest: REST, address: a.cosmos });
  const seal = deriveSealKeys({ mnemonic: mnemonicFor(role), index: 0 });
  const row = {
    role, evm: a.evm, registered, algorithmId, pubkeyBytes: pk.length,
    pubkeyMatchesDerived: pk.equals(Buffer.from(a.pqc.publicKey)),
    kemRegistered: kem.registered, kemMatchesSealKey: kem.publicKey ? Buffer.from(kem.publicKey).equals(Buffer.from(seal.mlkemPublicKey)) : false,
  };
  out[role] = row;
  console.log(JSON.stringify(row));
}
const relayer = await accountFor("relayer");
const w = await evmWindowStatus({ rest: REST, address: relayer.cosmos });
out.relayerWindow = JSON.parse(JSON.stringify(w, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
console.log("relayer window", out.relayerWindow);
// NOTE: @qorechain/sdk 0.14.0 has no explorer URL for the testnet preset
// (explorerTxUrl throws "explorer URL not configured for this network").
writeFileSync(new URL("./out/q3-keystatus.json", import.meta.url), JSON.stringify(out, null, 2));
