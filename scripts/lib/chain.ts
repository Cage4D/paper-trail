// Chain helpers for scripts/: viem clients on qorechain-diana and hybrid native broadcasts.
import { StargateClient } from "@cosmjs/stargate";
import { createPublicClient, createWalletClient, http, type Chain, type Hex } from "viem";
import { evmAccountFromPrivateKey, qorechainTestnet as kitTestnet } from "@qorechain/evm";
import { EthNativeSigner, getNetwork, type UnifiedAccount } from "@qorechain/sdk";
import type { EncodeObject } from "@cosmjs/proto-signing";

// @qorechain/evm 0.14.0 types its chain against an older viem `Chain` (prepareTransactionRequest
// phase union); the object itself is a valid viem chain, so it is cast once here.
const qorechainTestnet = kitTestnet as unknown as Chain & typeof kitTestnet;

export const NET = getNetwork("testnet");
export const REST = process.env.QORE_REST?.trim() || NET.endpoints.rest;
export const RPC = process.env.QORE_RPC?.trim() || NET.endpoints.rpc;
export const EVM_RPC = process.env.EVM_RPC?.trim() || qorechainTestnet.rpcUrls.default.http[0];
/** Explorer from @qorechain/evm's qorechainTestnet chain definition. */
export const EXPLORER = qorechainTestnet.blockExplorers.default.url;

export const publicClient = createPublicClient({ chain: qorechainTestnet, transport: http(EVM_RPC) });
export const walletFor = (acct: UnifiedAccount) =>
  createWalletClient({ chain: qorechainTestnet, transport: http(EVM_RPC), account: evmAccountFromPrivateKey(acct.privateKey as Hex) });

/** Hybrid-signed (secp256k1 + ML-DSA-87) native-lane broadcast with the template's fee. */
export async function broadcastHybrid(acct: UnifiedAccount, messages: EncodeObject[]) {
  const r = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${acct.cosmos}`);
  const a = ((await r.json()) as { account: Record<string, unknown> }).account;
  const b = (a.base_account ?? a) as Record<string, string>;
  const signer = new EthNativeSigner(acct, { signMode: "hybrid", rest: REST });
  const transport = await StargateClient.connect(RPC);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: NET.chainId, accountNumber: BigInt(b.account_number), sequence: BigInt(b.sequence),
      fee: { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" }, messages,
    });
    if (res.code !== 0) throw new Error(`native tx failed (code ${res.code}): ${res.rawLog}`);
    return res;
  } finally {
    transport.disconnect();
  }
}

export const bigintJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
