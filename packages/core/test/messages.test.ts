import { describe, expect, it } from "vitest";
import { createRoleKey, type RoleKey } from "../src/keys.js";
import { recipientCardFor } from "../src/register.js";
import { AddressNotSealableError, decodeMessageFile, encodeMessageFile, openMessage, resolveAddressRecipient, sealMessage } from "../src/messages.js";

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
/** A stand-in for QoreChain's KEM and PQC registries, in the REST response shapes. */
function fakeChain(registered: RoleKey[]) {
  return async (url: string) => {
    const kem = /\/qorechain\/pqc\/v1\/kem\/([^/?#]+)$/.exec(url);
    const pq = /\/qorechain\/pqc\/v1\/account\/([^/?#]+)$/.exec(url);
    const k = registered.find((x) => x.address === decodeURIComponent((kem ?? pq)![1]));
    if (kem) return new Response(JSON.stringify(k ? { found: true, key: { address: k.address, algorithm_id: 2, algorithm_name: "mlkem1024", public_key: b64(k.seal.mlkemPublicKey), registered_height: "1" } } : { found: false }), { status: 200 });
    return new Response(JSON.stringify(k ? { found: true, account: { address: k.address, public_key: b64(k.pq.publicKey), algorithm_id: "1", key_type: "hybrid", possession_proven: true } } : { found: false }), { status: k ? 200 : 404 });
  };
}

describe("messages sealed to QoreChain addresses", () => {
  const alice = createRoleKey();
  const bob = createRoleKey();
  const stranger = createRoleKey();
  const unregistered = createRoleKey();
  const fetch = fakeChain([alice, bob]);

  it("uses the verified card (hybrid) when there is one, the registered ML-KEM-1024 key alone otherwise", async () => {
    const a = await resolveAddressRecipient({ address: alice.address, card: recipientCardFor(alice), fetch });
    const b = await resolveAddressRecipient({ address: bob.address, fetch });
    expect(a.mode).toBe("hybrid");
    expect(a.recipient.x25519PublicKey).toBeDefined();
    expect(b.mode).toBe("mlkem");
    expect(b.recipient.x25519PublicKey).toBeUndefined();
  });

  it("seals hybrid only when every recipient is hybrid; each recipient opens it, a stranger can't", async () => {
    const a = await resolveAddressRecipient({ address: alice.address, card: recipientCardFor(alice), fetch });
    const b = await resolveAddressRecipient({ address: bob.address, fetch });
    expect(sealMessage({ text: "hi", to: [a] }).mode).toBe("hybrid");
    const file = decodeMessageFile(encodeMessageFile(sealMessage({ text: "Paper opens at 09:00", to: [a, b] })));
    expect(file.mode).toBe("mlkem");
    expect(file.to).toEqual([alice.address, bob.address]);
    expect(file.envelope).not.toContain("Paper");
    expect(openMessage(file, alice.seal)).toBe("Paper opens at 09:00");
    expect(openMessage(file, bob.seal)).toBe("Paper opens at 09:00");
    let code = "";
    try {
      openMessage(file, stranger.seal);
    } catch (e) {
      code = (e as { code?: string }).code ?? "";
    }
    expect(code).toBe("NOT_A_RECIPIENT");
  });

  it("won't open a file whose recipient list was edited", async () => {
    const b = await resolveAddressRecipient({ address: bob.address, fetch });
    const file = sealMessage({ text: "x", to: [b] });
    expect(() => openMessage({ ...file, to: [bob.address, stranger.address] }, bob.seal)).toThrow();
  });

  it("rejects an address with no registered key, a card that doesn't match the chain, and a non-address", async () => {
    await expect(resolveAddressRecipient({ address: unregistered.address, fetch })).rejects.toMatchObject({ reason: "no-kem-key" });
    await expect(resolveAddressRecipient({ address: bob.address, card: recipientCardFor(alice), fetch })).rejects.toBeInstanceOf(AddressNotSealableError);
    await expect(resolveAddressRecipient({ address: "not-an-address", fetch })).rejects.toMatchObject({ reason: "invalid-address" });
  });
});
