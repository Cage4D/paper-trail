/**
 * pnpm relayer:window [status|open] — the relayer's EVM authorisation window.
 *
 * QoreChain: `open` sends MsgOpenEVMWindow (hybrid-signed) narrowed with
 * allowedTargets = [PAPERTRAIL_ADDRESS], so the relayer's EVM spending is authorised for
 * the PaperTrail contract only (findings Q5). Opening replaces any earlier window and
 * advances the account nonce, so never run it while EVM txs are in flight.
 * Defaults: 17,280 blocks (the maximum, ~6.9 h), 50 txs, 5 QOR (value + max fees).
 */
import { evmWindowStatus } from "@qorechain/evm";
import { openEvmWindowMsg } from "@qorechain/sdk";
import { accountFor } from "./lib/env.js";
import { REST, bigintJson, broadcastHybrid } from "./lib/chain.js";

const cmd = process.argv[2] ?? "status";
const relayer = await accountFor("relayer");
if (cmd === "open") {
  const target = process.env.PAPERTRAIL_ADDRESS?.trim();
  if (!target) throw new Error("PAPERTRAIL_ADDRESS is not set; deploy first");
  const msg = openEvmWindowMsg({
    sender: relayer.cosmos,
    blocks: BigInt(process.env.QORE_WINDOW_BLOCKS ?? "17280"),
    maxTxs: BigInt(process.env.QORE_WINDOW_TXS ?? "50"),
    maxValue: BigInt(process.env.QORE_WINDOW_MAX_UQOR ?? "5000000"),
    allowedTargets: [target],
  });
  const res = await broadcastHybrid(relayer, [msg]);
  console.log("opened", res.transactionHash);
}
console.log(JSON.stringify(bigintJson(await evmWindowStatus({ rest: REST, address: relayer.cosmos }))));
