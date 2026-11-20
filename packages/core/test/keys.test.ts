import { describe, expect, it } from "vitest";
import { deriveUnifiedAccount } from "@qorechain/sdk";
import { createRoleKey, decryptRoleKey, encryptRoleKey, roleKeyFromMnemonic, wipeRoleKey } from "../src/keys.js";

const FAST = { m: 256, t: 1, p: 1 }; // test-only KDF cost
const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("keys", () => {
  it("derives the same account and ML-DSA-87 key as @qorechain/sdk deriveUnifiedAccount", async () => {
    const k = roleKeyFromMnemonic(M);
    const u = await deriveUnifiedAccount(M, 0);
    expect(k.address).toBe(u.cosmos);
    expect(k.evm.toLowerCase()).toBe(u.evm.toLowerCase());
    expect(Buffer.from(k.pq.publicKey).equals(Buffer.from(u.pqc.publicKey))).toBe(true);
    expect(k.seal.mlkemPublicKey.length).toBe(1568);
    expect(k.recipient.x25519PublicKey?.length).toBe(32);
  });

  it("createRoleKey makes a fresh 24-word key", () => {
    const k = createRoleKey();
    expect(k.mnemonic.split(" ").length).toBe(24);
    expect(k.address).toMatch(/^qor1/);
  });

  it("encrypt → decrypt round-trips; the blob holds no plaintext", () => {
    const k = createRoleKey();
    const blob = encryptRoleKey(k, "correct horse battery", FAST);
    expect(JSON.stringify(blob)).not.toContain(k.mnemonic.split(" ")[0] + " ");
    const back = decryptRoleKey(blob, "correct horse battery");
    expect(back.address).toBe(k.address);
    expect(Buffer.from(back.pq.secretKey).equals(Buffer.from(k.pq.secretKey))).toBe(true);
  });

  it("wrong passphrase and tampering are refused", () => {
    const blob = encryptRoleKey(createRoleKey(), "correct horse battery", FAST);
    expect(() => decryptRoleKey(blob, "wrong passphrase!")).toThrow(/wrong passphrase/);
    const t = { ...blob, ciphertext: (blob.ciphertext[0] === "A" ? "B" : "A") + blob.ciphertext.slice(1) };
    expect(() => decryptRoleKey(t, "correct horse battery")).toThrow(/wrong passphrase/);
    expect(() => encryptRoleKey(createRoleKey(), "short")).toThrow();
  });

  it("wipeRoleKey zeroes the secret key bytes", () => {
    const k = createRoleKey();
    wipeRoleKey(k);
    expect(k.pq.secretKey.every((b) => b === 0)).toBe(true);
    expect(k.classical.privateKey.every((b) => b === 0)).toBe(true);
    expect(k.seal.mlkemSecretKey.every((b) => b === 0)).toBe(true);
  });
});
