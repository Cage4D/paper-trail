// Live check (LIVE=1): resolveGroupRecipients run the way a browser runs it, with the ML-KEM key
// lookups answered by the EVM JSON-RPC (kemFetchViaEvmRpc), against the real marker group of a demo
// exam on qorechain-diana. Skipped by default: it needs the network and a live API.
import { describe, expect, it } from "vitest";
import { kemFetchViaEvmRpc, resolveGroupRecipients } from "../src/verify.js";

const API = process.env.PAPERTRAIL_API ?? "https://paper-trail-api.vercel.app";
const EVM_RPC = "https://evm-testnet.qore.host";
const REST = "https://api-testnet.qore.host";
const CONTRACT = "0xbe6b208Bc8990a68740053Dad68624914812cf8F";
const EXAM = process.env.LIVE_EXAM_ID ?? "0xfe79de8001e630167ac698bb961b0872dc941e772b4b66e6e3bef96e64811e98";

describe.runIf(process.env.LIVE === "1")("resolveGroupRecipients in a browser-like setup (live)", () => {
  it("verifies the markers' cards against their on-chain keys, reading KEM keys over the EVM RPC", async () => {
    const g = await (await fetch(`${API}/exams/${EXAM}/markers`)).json();
    let restCalls = 0;
    const rpcFetch = kemFetchViaEvmRpc(EVM_RPC);
    const recipients = await resolveGroupRecipients({
      evmRpc: EVM_RPC, rest: REST, contract: CONTRACT, board: g.board, groupChainId: g.groupChainId, epoch: g.epoch, epochTx: g.epochTx, members: g.members,
      fetch: (url, init) => {
        if (url.startsWith(REST)) restCalls++;
        return rpcFetch(url, init);
      },
    });
    expect(recipients).toHaveLength(g.members.length);
    expect(restCalls).toBe(g.members.length); // every KEM lookup went through the RPC shim
    for (const r of recipients) expect(r.mlkemPublicKey.length).toBe(1568); // ML-KEM-1024
  }, 60_000);
});
