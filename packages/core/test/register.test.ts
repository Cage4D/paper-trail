import { describe, expect, it } from "vitest";
import { checkRecipientCard, recipientCardFor, roleStatus } from "../src/register.js";
import { createRoleKey, roleKeyFromMnemonic } from "../src/keys.js";

describe("register: recipient card (offline)", () => {
  const role = createRoleKey();
  it("a role's card verifies against its own on-chain keys and yields its hybrid recipient", () => {
    const card = recipientCardFor(role);
    expect(card.address).toBe(role.address);
    const r = checkRecipientCard(card, { pqPublicKey: role.pq.publicKey, mlkemPublicKey: role.seal.mlkemPublicKey });
    expect(Buffer.from(r.x25519PublicKey!).equals(Buffer.from(role.seal.x25519PublicKey))).toBe(true);
  });
  it("a card checked against someone else's keys is refused", () => {
    const other = createRoleKey();
    expect(() => checkRecipientCard(recipientCardFor(role), { pqPublicKey: other.pq.publicKey, mlkemPublicKey: role.seal.mlkemPublicKey })).toThrow();
    expect(() => checkRecipientCard(recipientCardFor(role), { pqPublicKey: role.pq.publicKey, mlkemPublicKey: other.seal.mlkemPublicKey })).toThrow();
  });
});

// LIVE=1: read-only status against diana (no transactions). Uses RELAYER_MNEMONIC from the env.
describe.runIf(process.env.LIVE === "1" && !!process.env.RELAYER_MNEMONIC)("register: live status on diana (read-only)", () => {
  it("the relayer reports both keys registered as its own", async () => {
    const s = await roleStatus(roleKeyFromMnemonic(process.env.RELAYER_MNEMONIC!));
    expect(s).toMatchObject({ pqc: "registered", kem: "registered" });
  }, 60_000);
  it("a fresh key reports not-registered", async () => {
    expect(await roleStatus(createRoleKey())).toMatchObject({ pqc: "not-registered", kem: "not-registered" });
  }, 60_000);
});
