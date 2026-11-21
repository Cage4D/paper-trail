import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLE_PAPER } from "../src/sample-paper.js";
import { simulateLeak } from "../src/leak-sim.js";
import { matchLeak } from "../src/detect.js";
import { generateCopies, parsePaper } from "../src/paper.js";

describe("embedded sample paper and simulated leaks", () => {
  it("SAMPLE_PAPER equals fixtures/sample-paper.md", () => {
    expect(SAMPLE_PAPER).toBe(readFileSync(new URL("../fixtures/sample-paper.md", import.meta.url), "utf8"));
  });
  it("simulateLeak is deterministic and traceable", () => {
    const paper = parsePaper(SAMPLE_PAPER);
    const r = generateCopies(paper, new Uint8Array(32).fill(9), ["A", "B"]);
    const leak = simulateLeak(r.centres.B.text, 3, 42);
    expect(simulateLeak(r.centres.B.text, 3, 42)).toBe(leak);
    expect(matchLeak(leak, paper, r.tables).copy).toBe("B");
  });
});
