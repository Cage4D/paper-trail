// LIVE=1: seal to a real registered QoreChain address, the way a browser does it (registries read
// through the EVM JSON-RPC), using Marker 1's card from the Paper Trail directory for hybrid mode.
import { describe, expect, it } from "vitest";
import { chainFetchViaEvmRpc } from "../src/verify.js";
import { createRoleKey } from "../src/keys.js";
import { decodeMessageFile, encodeMessageFile, resolveAddressRecipient, sealMessage } from "../src/messages.js";

const API = process.env.PAPERTRAIL_API ?? "https://paper-trail-api.vercel.app";
const fetch = chainFetchViaEvmRpc("https://evm-testnet.qore.host");
const MARKER1 = "qor1u39s6c9ujvy9kpuz22p0mzck4q9k7f5y6nv85d";

describe.runIf(process.env.LIVE === "1")("seal to a registered address (live)", () => {
  it("hybrid with the verified directory card, mlkem without it; an unregistered address is refused", async () => {
    const dir = (await (await globalThis.fetch(`${API}/directory?role=marker`)).json()) as { roleAddress: string; sealCard: never }[];
    const card = dir.find((d) => d.roleAddress === MARKER1)!.sealCard;
    const hybrid = await resolveAddressRecipient({ address: MARKER1, card, fetch });
    const mlkem = await resolveAddressRecipient({ address: MARKER1, fetch });
    expect(hybrid.mode).toBe("hybrid");
    expect(mlkem.mode).toBe("mlkem");
    expect(mlkem.recipient.mlkemPublicKey.length).toBe(1568);
    const file = decodeMessageFile(encodeMessageFile(sealMessage({ text: "hello Marker 1", to: [hybrid] })));
    expect(file.to).toEqual([MARKER1]);
    await expect(resolveAddressRecipient({ address: createRoleKey().address, fetch })).rejects.toMatchObject({ reason: "no-kem-key" });
  }, 60_000);
});
