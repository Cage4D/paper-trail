import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchLeak } from "../src/detect.js";
import { generateCopies, parsePaper, type RenderedCopy } from "../src/paper.js";

const paper = parsePaper(readFileSync(new URL("../fixtures/sample-paper.md", import.meta.url), "utf8"));

/** Small deterministic PRNG for the test harness (not crypto). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(a: T[]) => a[Math.floor(next() * a.length)] };
}

/** A leaked excerpt: `k` random questions of a copy (in its order), retyped with noise. */
function leak(copy: RenderedCopy, k: number, r: ReturnType<typeof rng>): string {
  const blocks = copy.text.split(/\n(?=Q\d+:)/).filter((b) => /^Q\d+:/.test(b));
  const chosen = new Set<number>();
  while (chosen.size < Math.min(k, blocks.length)) chosen.add(r.int(blocks.length));
  const out: string[] = [];
  [...chosen].sort((a, b) => a - b).forEach((bi, n) => {
    const lines = blocks[bi].split("\n").filter((l) => l.trim());
    let stem = lines[0].replace(/^Q\d+:\s*/, "");
    const options = lines.slice(1).filter((l) => l.startsWith("- [ ]")).map((l) => l.slice(6));
    const noisy = (s: string) => {
      let t = s;
      if (r.next() < 0.3) t = t.toUpperCase();
      if (r.next() < 0.4) t = t.replace(/[,.?²]/g, "");
      if (r.next() < 0.3) t = t.replace(/ /g, "  ");
      return t;
    };
    if (r.next() < 0.5) {
      // one typo in a random stem word longer than 4 letters
      const words = stem.split(" ");
      const idx = words.map((w, i) => (w.length > 4 ? i : -1)).filter((i) => i >= 0);
      if (idx.length) {
        const w = words[r.pick(idx)];
        words[words.indexOf(w)] = w.slice(0, 2) + w[3] + w[2] + w.slice(4);
        stem = words.join(" ");
      }
    }
    const marker = r.pick([`Q${n + 1}: `, `${n + 1}. `, `Question ${n + 1}) `, `Q: `]);
    out.push(marker + noisy(stem));
    const style = r.int(3);
    options.forEach((o, oi) => {
      if (r.next() < 0.1) return; // a dropped option
      out.push((style === 0 ? "- [ ] " : style === 1 ? `${"abcd"[oi]}) ` : "* ") + noisy(o));
    });
    out.push("");
  });
  return out.join("\n");
}

describe("detect: matchLeak", () => {
  it("names the right centre for a clean full copy, and the master for the master", () => {
    const r = generateCopies(paper, new Uint8Array(32).fill(1), ["A", "B", "C"]);
    for (const c of ["A", "B", "C"]) expect(matchLeak(r.centres[c].text, paper, r.tables).copy).toBe(c);
    const m = matchLeak(r.master.text, paper, r.tables);
    expect(m.copy).toBe("master");
    expect(m.confidence).toBeGreaterThan(0.9);
  });

  it("returns no copy for unrelated text", () => {
    const r = generateCopies(paper, new Uint8Array(32).fill(2), ["A", "B"]);
    expect(matchLeak("Q1: What is the capital of France?\n- Paris\n- Rome", paper, r.tables).copy).toBeNull();
  });

  it("accuracy: ≥ 95% correct from 3 random questions over 1,000 trials with 2–8 centres (spec §4.3)", () => {
    const r = rng(20261120);
    let correct = 0;
    const misses: string[] = [];
    for (let trial = 0; trial < 1000; trial++) {
      const n = 2 + r.int(7);
      const ids = Array.from({ length: n }, (_, i) => `centre-${i}`);
      const secret = new Uint8Array(32).map(() => r.int(256));
      const res = generateCopies(paper, secret, ids);
      const source = r.next() < 0.1 ? "master" : r.pick(ids);
      const copy = source === "master" ? res.master : res.centres[source];
      const m = matchLeak(leak(copy, 3, r), paper, res.tables);
      if (m.copy === source) correct++;
      else if (misses.length < 5) misses.push(`${trial}: ${source} → ${m.copy} (${m.observedBits} bits, margin ${m.distanceToRunnerUp})`);
    }
    console.log(`detector accuracy: ${correct}/1000`, misses);
    expect(correct).toBeGreaterThanOrEqual(950);
  }, 120_000);
});
