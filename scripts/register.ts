/**
 * pnpm register [--status] [role ...] — register each role account's PQC (ML-DSA-87)
 * and KEM (ML-KEM-1024) keys on qorechain-diana. Idempotent; status is read first.
 *
 * QoreChain specifics:
 *  - PQC: @qorechain/sdk `ensurePqcRegistered`, which reads the status over REST first and
 *    does NOT broadcast when the key is already registered: a second
 *    registration is refused AFTER the fee is charged. It sends MsgRegisterPQCKeyV2 with a
 *    proof of possession. It is the one message the chain accepts signed classically, so it
 *    goes through the template's EthNativeSigner in "classical" mode (eth_secp256k1 account).
 *  - KEM: MsgRegisterKEMKey (`msg.pqc.registerKemKey`, algorithm ML-KEM-1024) with the
 *    account's QoreSeal key (`deriveSealKeys` from the same mnemonic, index 0). It must be
 *    hybrid-signed (the account needs its ML-DSA-87 key first). Registering again would
 *    replace the key, so it is skipped when the on-chain key already equals ours.
 * Prints only public data; writes scripts/out/registrations.json (tx hashes, fees).
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { StargateClient, type DeliverTxResponse } from "@cosmjs/stargate";
import {
  EthNativeSigner, KEM_ALGORITHM_ML_KEM_1024, TxClient, ensurePqcRegistered, fetchKemKey,
  fetchPqcStatus, getNetwork, isRegisteredPqcKey, msg, type SigningClientLike, type UnifiedAccount,
} from "@qorechain/sdk";
import { deriveSealKeys } from "@qorechain/qoreseal";
import { accountFor, mnemonicFor, type Role } from "./lib/env.js";

const net = getNetwork("testnet");
const REST = process.env.QORE_REST?.trim() || net.endpoints.rest;
const RPC = process.env.QORE_RPC?.trim() || net.endpoints.rpc;
const CHAIN_ID = net.chainId;
// Template fee for native-lane txs (hybrid txs are large): 0.1 QOR, 800k gas.
const FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };
const OUT = new URL("./out/registrations.json", import.meta.url);

async function balance(addr: string): Promise<bigint> {
  const r = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${addr}/by_denom?denom=uqor`);
  return BigInt(((await r.json()) as { balance?: { amount?: string } }).balance?.amount ?? "0");
}
async function sequence(addr: string) {
  const r = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${addr}`);
  if (!r.ok) throw new Error(`account ${addr}: HTTP ${r.status} (not funded?)`);
  const a = ((await r.json()) as { account: Record<string, unknown> }).account;
  const b = (a.base_account ?? a) as Record<string, string>;
  return { accountNumber: BigInt(b.account_number ?? "0"), sequence: BigInt(b.sequence ?? "0") };
}

/** SigningClientLike over EthNativeSigner, so the SDK's TxClient/ensurePqcRegistered can drive it. */
function adapter(acct: UnifiedAccount, mode: "classical" | "hybrid"): SigningClientLike {
  const signer = new EthNativeSigner(acct, { signMode: mode, rest: REST });
  return {
    async simulate() { throw new Error("simulate not used: explicit fee"); },
    async signAndBroadcastSync() { throw new Error("sync broadcast not used"); },
    async getChainId() { return CHAIN_ID; },
    async getSequence(a: string) { return sequence(a); },
    async signAndBroadcast(_addr, messages, fee, memo) {
      const transport = await StargateClient.connect(RPC);
      try {
        const res = await signer.signAndBroadcast(transport, { chainId: CHAIN_ID, ...(await sequence(acct.cosmos)), fee, messages, memo });
        return { code: res.code, transactionHash: res.transactionHash, height: res.height ?? 0, gasUsed: res.gasUsed ?? 0n,
          gasWanted: res.gasWanted ?? 0n, rawLog: res.rawLog, events: [], msgResponses: [], txIndex: 0 } as unknown as DeliverTxResponse;
      } finally { transport.disconnect(); }
    },
  };
}

const args = process.argv.slice(2);
const statusOnly = args.includes("--status");
const roles = (args.filter((a) => !a.startsWith("--")) as Role[]);
if (!roles.length) roles.push("relayer", "board", "examiner1", "examiner2");

const log: Record<string, unknown> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
for (const role of roles) {
  const acct = await accountFor(role);
  const seal = deriveSealKeys({ mnemonic: mnemonicFor(role), index: 0 });
  const pqc = await fetchPqcStatus({ rest: REST, address: acct.cosmos });
  const kem = await fetchKemKey({ rest: REST, address: acct.cosmos });
  const kemMine = kem.found && kem.key?.publicKey ? Buffer.from(kem.key.publicKey).equals(Buffer.from(seal.mlkemPublicKey)) : false;
  const row: Record<string, unknown> = {
    role, address: acct.cosmos, evm: acct.evm, balanceUqor: (await balance(acct.cosmos)).toString(),
    pqc: pqc.registered ? (isRegisteredPqcKey(pqc, acct.pqc.publicKey) ? "registered (this key)" : "registered, NOT this key") : "not registered",
    pqcAlgorithmId: (pqc as { algorithmId?: number }).algorithmId,
    kem: kem.found ? (kemMine ? "registered (this key)" : "registered, NOT this key") : "not registered",
  };
  if (!statusOnly) {
    const prev = (log[role] ?? {}) as Record<string, unknown>;
    if (!pqc.registered) {
      const before = await balance(acct.cosmos);
      const tx = new TxClient({ signingClient: adapter(acct, "classical"), senderAddress: acct.cosmos });
      const r = await ensurePqcRegistered(tx, { pqcKeypair: acct.pqc, rest: REST, chainId: CHAIN_ID, fee: FEE });
      if (r.result && (r.result as { code?: number }).code) throw new Error(`${role}: PQC registration failed: ${(r.result as { rawLog?: string }).rawLog}`);
      prev.pqcTx = r.txHash;
      prev.pqcCostUqor = (before - (await balance(acct.cosmos))).toString();
      row.pqc = `registered now (${r.txHash})`;
    } else if (!isRegisteredPqcKey(pqc, acct.pqc.publicKey)) {
      throw new Error(`${role}: a DIFFERENT PQC key is registered; stop and investigate (no tx sent)`);
    }
    if (!kemMine) {
      if (kem.found) throw new Error(`${role}: a different KEM key is registered; not replacing it automatically`);
      const before = await balance(acct.cosmos);
      const m = msg.pqc.registerKemKey({ sender: acct.cosmos, algorithmId: KEM_ALGORITHM_ML_KEM_1024, publicKey: seal.mlkemPublicKey });
      const res = await adapter(acct, "hybrid").signAndBroadcast(acct.cosmos, [m], FEE, "");
      if (res.code !== 0) throw new Error(`${role}: KEM registration failed (code ${res.code}): ${res.rawLog}`);
      prev.kemTx = res.transactionHash;
      prev.kemGasUsed = res.gasUsed.toString();
      prev.kemCostUqor = (before - (await balance(acct.cosmos))).toString();
      row.kem = `registered now (${res.transactionHash})`;
    }
    log[role] = { address: acct.cosmos, evm: acct.evm, ...prev };
  }
  console.log(JSON.stringify(row));
}
if (!statusOnly) {
  mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
  writeFileSync(OUT, JSON.stringify(log, null, 2));
}
