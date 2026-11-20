/**
 * Finding Q8 — is `shamir-secret-sharing` byte-identical in Node and the browser build?
 *
 * The package has ONE algorithm module (esm/index.js) and two CSPRNG modules picked by
 * export condition: `node` → csprng.node.js (node:crypto randomBytes), otherwise
 * csprng.js (crypto.getRandomValues). Run twice by `pnpm findings:q8`:
 *   - env node   (default resolve conditions → csprng.node.js)
 *   - env jsdom  (resolve conditions ["browser"] → csprng.js)
 * Each run: (1) with the CSPRNG replaced by one fixed byte stream, split → SHA-256 of the
 * shares, which must be identical across runs; (2) real randomness: 2-of-3 round-trip, and
 * combining shares produced by the OTHER environment (cross-combine).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const ENV = typeof window === "undefined" ? "node" : "jsdom";
// string paths: under jsdom the global URL is jsdom's, so avoid URL objects for fs
const DIR = join(dirname(fileURLToPath(import.meta.url)), "out");
const OUT = join(DIR, `q8-${ENV}.json`);
const OTHER = join(DIR, `q8-${ENV === "node" ? "jsdom" : "node"}.json`);
const SECRET = new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff); // stand-in for K_c

let fixed = false;
let counter = 0;
vi.mock("shamir-secret-sharing/csprng", async (orig) => {
  const real = (await orig()) as { getRandomBytes: (n: number) => Uint8Array };
  return {
    getRandomBytes: (n: number) => {
      if (!fixed) return real.getRandomBytes(n);
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = (counter++ * 131 + 7) & 0xff;
      return out;
    },
  };
});
const { split, combine } = await import("shamir-secret-sharing");
const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

describe(`shamir-secret-sharing under ${ENV}`, () => {
  it("deterministic randomness → identical shares; real randomness → round-trip + cross-combine", async () => {
    fixed = true; counter = 0;
    const det = await split(SECRET, 3, 2);
    fixed = false;
    const detHash = createHash("sha256").update(Buffer.concat(det.map((s) => Buffer.from(s)))).digest("hex");

    const real = await split(SECRET, 3, 2);
    for (const pair of [[0, 1], [0, 2], [1, 2]]) {
      expect(hex(await combine(pair.map((i) => real[i])))).toBe(hex(SECRET));
    }
    const result: Record<string, unknown> = { env: ENV, detSharesSha256: detHash, realShares: real.map(hex) };
    if (existsSync(OTHER)) {
      const other = JSON.parse(readFileSync(OTHER, "utf8"));
      result.sameDeterministicSharesAsOther = other.detSharesSha256 === detHash;
      const cross = await combine([other.realShares[0], other.realShares[2]].map((h: string) => new Uint8Array(Buffer.from(h, "hex"))));
      result.crossCombineOk = hex(cross) === hex(SECRET);
      expect(result.sameDeterministicSharesAsOther).toBe(true);
      expect(result.crossCombineOk).toBe(true);
    }
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    process.stdout.write("\n" + JSON.stringify({ ...result, realShares: `${real.length} shares` }) + "\n");
  });
});
