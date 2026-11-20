/**
 * ensureRoleOnChain — put a role key on qorechain-diana (spec §6 register.ts). Idempotent.
 *
 * QoreChain:
 *  - PQC key: @qorechain/sdk `ensurePqcRegistered` reads the status first and does not
 *    broadcast when this key is already registered. A SECOND registration is refused AFTER
 *    the fee is charged, and a different registered key is an error. The registration tx is
 *    the one message the chain accepts classically signed (EthNativeSigner "classical").
 *  - KEM key: MsgRegisterKEMKey (ML-KEM-1024), hybrid-signed; skipped when the on-chain key
 *    already equals this role's sealing key (registering again would replace it).
 *  - Recipient card: signed with QoreSign (classical + ML-DSA-87); NOT on chain. The API
 *    hosts it, and senders pass it to `sealToAddresses` (findings Q6).
 * The account must hold some testnet QOR for fees (0.1 QOR per tx with the default fee).
 */
import { StargateClient, type DeliverTxResponse } from "@cosmjs/stargate";
import {
  EthNativeSigner, KEM_ALGORITHM_ML_KEM_1024, TxClient, deriveUnifiedAccount, ensurePqcRegistered, fetchKemKey,
  fetchPqcStatus, getNetwork, isRegisteredPqcKey, msg, type SigningClientLike, type UnifiedAccount,
} from "@qorechain/sdk";
import { signRecipientCard, verifyRecipientCard, type RecipientCard } from "@qorechain/qoreseal";
import type { RoleKey } from "./keys.js";
import { CHAIN_ID } from "./util.js";

export interface ChainOptions {
  rest?: string;
  rpc?: string;
  /** Native-lane fee per tx (default 100000 uqor, 800k gas, as in the template). */
  fee?: { amount: { denom: string; amount: string }[]; gas: string };
}

export interface RoleStatus {
  address: string;
  pqc: "registered" | "not-registered" | "other-key";
  kem: "registered" | "not-registered" | "other-key";
}

const DEFAULT_FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };
const endpoints = (o: ChainOptions) => {
  const n = getNetwork("testnet");
  return { rest: o.rest ?? n.endpoints.rest, rpc: o.rpc ?? n.endpoints.rpc };
};

export async function roleStatus(role: RoleKey, o: ChainOptions = {}): Promise<RoleStatus> {
  const { rest } = endpoints(o);
  const pqc = await fetchPqcStatus({ rest, address: role.address });
  const kem = await fetchKemKey({ rest, address: role.address });
  const kemMine = kem.found && kem.key?.publicKey ? eq(kem.key.publicKey, role.seal.mlkemPublicKey) : false;
  return {
    address: role.address,
    pqc: !pqc.registered ? "not-registered" : isRegisteredPqcKey(pqc, role.pq.publicKey) ? "registered" : "other-key",
    kem: !kem.found ? "not-registered" : kemMine ? "registered" : "other-key",
  };
}

/** The role's signed QoreSeal recipient card (public; the API stores and serves it). */
export function recipientCardFor(role: RoleKey, issuedAt?: Date): RecipientCard {
  return signRecipientCard({ chainId: CHAIN_ID, address: role.address, keys: role.seal, classicalKey: role.classical, pqKey: role.pq, issuedAt });
}

/** Check a card against the keys registered on chain; returns the sealing recipient. */
export function checkRecipientCard(card: RecipientCard, onChain: { pqPublicKey: Uint8Array; mlkemPublicKey: Uint8Array; address?: string }) {
  return verifyRecipientCard({ card, chainId: CHAIN_ID, ...onChain });
}

export async function ensureRoleOnChain(role: RoleKey, o: ChainOptions = {}) {
  const { rest, rpc } = endpoints(o);
  const fee = o.fee ?? DEFAULT_FEE;
  const acct = await deriveUnifiedAccount(role.mnemonic, 0);
  if (acct.cosmos !== role.address) throw new Error("role key and SDK account differ");
  const before = await roleStatus(role, o);
  if (before.pqc === "other-key") throw new Error(`${role.address} has a DIFFERENT ML-DSA-87 key registered; not touching it`);
  if (before.kem === "other-key") throw new Error(`${role.address} has a different KEM key registered; not replacing it automatically`);

  const result: { pqcTx?: string; kemTx?: string; card: RecipientCard } = { card: recipientCardFor(role) };
  if (before.pqc === "not-registered") {
    const tx = new TxClient({ signingClient: adapter(acct, "classical", rest, rpc), senderAddress: acct.cosmos });
    const r = await ensurePqcRegistered(tx, { pqcKeypair: acct.pqc, rest, chainId: CHAIN_ID, fee });
    if ((r.result as { code?: number } | undefined)?.code) throw new Error("PQC registration failed");
    result.pqcTx = r.txHash;
  }
  if (before.kem === "not-registered") {
    const m = msg.pqc.registerKemKey({ sender: acct.cosmos, algorithmId: KEM_ALGORITHM_ML_KEM_1024, publicKey: role.seal.mlkemPublicKey });
    const r = await adapter(acct, "hybrid", rest, rpc).signAndBroadcast(acct.cosmos, [m], fee, "");
    if (r.code !== 0) throw new Error(`KEM registration failed (code ${r.code})`);
    result.kemTx = r.transactionHash;
  }
  return { ...result, status: await roleStatus(role, o) };
}

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

async function sequence(rest: string, addr: string) {
  const r = await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${addr}`);
  if (!r.ok) throw new Error(`account ${addr}: HTTP ${r.status} (fund it with testnet QOR first)`);
  const a = ((await r.json()) as { account: Record<string, unknown> }).account;
  const b = (a.base_account ?? a) as Record<string, string>;
  return { accountNumber: BigInt(b.account_number ?? "0"), sequence: BigInt(b.sequence ?? "0") };
}

/** SigningClientLike over EthNativeSigner, so the SDK's TxClient/ensurePqcRegistered can drive an eth-native account. */
function adapter(acct: UnifiedAccount, mode: "classical" | "hybrid", rest: string, rpc: string): SigningClientLike {
  const signer = new EthNativeSigner(acct, { signMode: mode, rest });
  return {
    async simulate() { throw new Error("simulate not used: explicit fee"); },
    async signAndBroadcastSync() { throw new Error("sync broadcast not used"); },
    async getChainId() { return CHAIN_ID; },
    async getSequence(a: string) { return sequence(rest, a); },
    async signAndBroadcast(_addr, messages, fee, memo) {
      const transport = await StargateClient.connect(rpc);
      try {
        const res = await signer.signAndBroadcast(transport, { chainId: CHAIN_ID, ...(await sequence(rest, acct.cosmos)), fee, messages, memo });
        return { code: res.code, transactionHash: res.transactionHash, height: res.height ?? 0, gasUsed: res.gasUsed ?? 0n,
          gasWanted: res.gasWanted ?? 0n, rawLog: res.rawLog, events: [], msgResponses: [], txIndex: 0 } as unknown as DeliverTxResponse;
      } finally {
        transport.disconnect();
      }
    },
  };
}
