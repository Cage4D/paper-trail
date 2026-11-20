/**
 * pnpm transfer <fromRole> <toRole> <uqor> — move testnet QOR between our role accounts.
 *
 * QoreChain: once an account has a registered ML-DSA-87 key, its native-lane txs are
 * signed hybrid (secp256k1 + ML-DSA-87) through the SDK's EthNativeSigner.bankSend.
 * Testnet only (chain id from getNetwork("testnet")). Prints only addresses and the tx hash.
 */
import { StargateClient } from "@cosmjs/stargate";
import { EthNativeSigner, getNetwork } from "@qorechain/sdk";
import { accountFor, ALL_ROLES, type Role } from "./lib/env.js";

const [from, to, amount] = process.argv.slice(2) as [Role, Role, string];
if (!ALL_ROLES.includes(from) || !ALL_ROLES.includes(to) || !/^\d+$/.test(amount ?? "")) {
  console.error(`usage: pnpm transfer <fromRole> <toRole> <uqor>; roles: ${ALL_ROLES.join(", ")}`);
  process.exit(1);
}
const net = getNetwork("testnet");
const REST = process.env.QORE_REST?.trim() || net.endpoints.rest;
const RPC = process.env.QORE_RPC?.trim() || net.endpoints.rpc;
const src = await accountFor(from);
const dst = await accountFor(to);
const acc = (await (await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${src.cosmos}`)).json()) as {
  account: Record<string, unknown>;
};
const base = (acc.account.base_account ?? acc.account) as Record<string, string>;
const signer = new EthNativeSigner(src, { signMode: "hybrid", rest: REST });
const transport = await StargateClient.connect(RPC);
try {
  const res = await signer.bankSend(transport, dst.cosmos, [{ denom: "uqor", amount }], {
    chainId: net.chainId,
    accountNumber: BigInt(base.account_number),
    sequence: BigInt(base.sequence),
    fee: { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" },
  });
  if (res.code !== 0) throw new Error(`transfer failed with code ${res.code}`);
  console.log(JSON.stringify({ from: `${from} ${src.cosmos}`, to: `${to} ${dst.cosmos}`, uqor: amount, tx: res.transactionHash }));
} finally {
  transport.disconnect();
}
