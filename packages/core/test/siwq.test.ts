import { describe, expect, it } from "vitest";
import { createSignIn, signSignIn, verifySignIn } from "../src/siwq.js";
import { createRoleKey } from "../src/keys.js";

describe("siwq (role-key sign-in, decision D2)", () => {
  const role = createRoleKey();
  const msg = createSignIn({ domain: "papertrail.example", uri: "https://papertrail.example/login", address: role.address, nonce: "n0nce12345" });
  it("signs with both keys and verifies against the ML-DSA-87 key", () => {
    const sig = signSignIn(role, msg);
    expect(sig.signatureType).toBe("ml-dsa-87-hybrid");
    const fields = verifySignIn({ message: msg, signature: sig, domain: "papertrail.example", nonce: "n0nce12345", pqPublicKey: role.pq.publicKey });
    expect(fields.address).toBe(role.address);
  });
  it("refuses another domain, nonce or key", () => {
    const sig = signSignIn(role, msg);
    expect(() => verifySignIn({ message: msg, signature: sig, domain: "evil.example", nonce: "n0nce12345", pqPublicKey: role.pq.publicKey })).toThrow();
    expect(() => verifySignIn({ message: msg, signature: sig, domain: "papertrail.example", nonce: "other12345", pqPublicKey: role.pq.publicKey })).toThrow();
    expect(() => verifySignIn({ message: msg, signature: sig, domain: "papertrail.example", nonce: "n0nce12345", pqPublicKey: createRoleKey().pq.publicKey })).toThrow();
  });
});
