/**
 * Spec §6: Shamir output identical in Node and the browser build (run under jsdom).
 * Run by vitest.config.ts in two projects: node, and jsdom with browser export conditions
 * (shamir-secret-sharing then resolves its browser CSPRNG module). With the CSPRNG replaced
 * by one fixed stream, both must produce the same share bytes (findings Q8).
 */
import { describe, expect, it, vi } from "vitest";
import { sha3Hex } from "../src/util.js";

let fixed = false;
let ctr = 0;
vi.mock("shamir-secret-sharing/csprng", async (orig) => {
  const real = (await orig()) as { getRandomBytes: (n: number) => Uint8Array };
  return { getRandomBytes: (n: number) => (fixed ? new Uint8Array(n).map(() => (ctr++ * 131 + 7) & 0xff) : real.getRandomBytes(n)) };
});
const { split, combine } = await import("shamir-secret-sharing");

const SECRET = new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff);

describe(`shamir under ${typeof window === "undefined" ? "node" : "jsdom"}`, () => {
  it("fixed randomness → identical shares in node and jsdom", async () => {
    fixed = true;
    ctr = 0;
    const shares = await split(SECRET, 3, 2);
    fixed = false;
    const all = new Uint8Array(shares.reduce((n, s) => n + s.length, 0));
    let o = 0;
    for (const s of shares) all.set(s, o), (o += s.length);
    // one recorded value; the node and the jsdom project must both reproduce it
    expect(sha3Hex(all)).toMatchInlineSnapshot(`"0x3ddbe4bc2af09b8acf2054a6a641c95d660cb94dd56f68ae06f34359e6169d3b"`);
  });
  it("real randomness round-trips 2-of-3", async () => {
    const s = await split(SECRET, 3, 2);
    for (const p of [[0, 1], [0, 2], [1, 2]]) expect(Array.from(await combine(p.map((i) => s[i])))).toEqual(Array.from(SECRET));
  });
});
