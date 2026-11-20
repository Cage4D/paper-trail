import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allQuestions, bitLayout, commitmentOf, fingerprintBits, fingerprintDistance, generateCopies, parsePaper, renderCopy, variantTable,
} from "../src/paper.js";
import { fromHex } from "../src/util.js";

const SAMPLE = readFileSync(new URL("../fixtures/sample-paper.md", import.meta.url), "utf8");
const SECRET = fromHex("0x" + "42".repeat(32));
const CENTRES = ["centre-A", "centre-B", "centre-C", "centre-D", "centre-E", "centre-F", "centre-G", "centre-H"];

describe("paper: parsing", () => {
  const p = parsePaper(SAMPLE);
  it("reads sections, questions, options, answers and toggles", () => {
    expect(p.title).toMatch(/General Science Mock/);
    expect(p.sections.map((s) => s.questions.length)).toEqual([6, 6]);
    expect(allQuestions(p).every((q) => q.options.length === 4 && q.options.filter((o) => o.correct).length === 1)).toBe(true);
    expect(p.toggleCount).toBe(18);
    expect(p.sections[0].intro).toMatch(/Answer every question/);
  });
  it("rejects malformed papers", () => {
    expect(() => parsePaper("## S\nQ: x\n- [ ] a\n- [ ] b\n")).toThrow(/no correct option/);
    expect(() => parsePaper("Q: x\n- [x] a\n- [ ] b\n")).toThrow();
    expect(() => parsePaper("## S\nQ: {{a|b x\n- [x] a\n- [ ] b\n")).toThrow(/malformed toggle/);
    expect(() => parsePaper("## S\n")).toThrow(/no questions/);
  });
});

describe("paper: copies", () => {
  const p = parsePaper(SAMPLE);
  const r = generateCopies(p, SECRET, CENTRES);

  it("is deterministic from (examSecret, centreId)", () => {
    const again = generateCopies(p, SECRET, CENTRES);
    for (const c of CENTRES) expect(again.centres[c].commitment).toBe(r.centres[c].commitment);
    const other = generateCopies(p, fromHex("0x" + "43".repeat(32)), CENTRES);
    expect(other.centres["centre-A"].commitment).not.toBe(r.centres["centre-A"].commitment);
  });

  it("master is the canonical order with first alternatives", () => {
    expect(r.master.text).toContain("Q1: Which quantity is measured in newtons when a book rests");
    expect(r.master.answerKey[0].correct).toEqual([0]);
  });

  it("distance rule: every pair of copies differs in ≥ 20 fingerprint bits", () => {
    expect(r.warning).toBeUndefined();
    expect(r.minPairDistance).toBeGreaterThanOrEqual(20);
    const layout = bitLayout(p);
    const bits = r.tables.map((t) => fingerprintBits(p, t, layout));
    for (let i = 0; i < bits.length; i++) for (let j = i + 1; j < bits.length; j++) expect(fingerprintDistance(bits[i], bits[j])).toBeGreaterThanOrEqual(20);
  });

  it("warns when the paper is too small to keep copies apart", () => {
    const tiny = parsePaper("## S\nQ: one\n- [x] a\n- [ ] b\nQ: two\n- [x] c\n- [ ] d\n");
    const t = generateCopies(tiny, SECRET, ["A", "B", "C"], { maxAttempts: 20 });
    expect(t.warning).toMatch(/Add more/);
  });

  it("commitment is SHA3-256 of the copy's exact bytes; no answer marks leak", () => {
    const a = r.centres["centre-A"];
    expect(a.commitment).toBe(commitmentOf(a.text));
    expect(commitmentOf(a.text + " ")).not.toBe(a.commitment);
    expect(a.text).not.toMatch(/\[x\]/i);
    expect(a.text).not.toMatch(/\{\{|\}\}/);
  });

  it("answer keys are remapped: each displayed correct option is the canonical correct one", () => {
    const qs = allQuestions(p);
    for (const c of Object.values(r.centres)) {
      let n = 0;
      c.table.questionOrder.forEach((order, si) => {
        for (const qi of order) {
          const q = p.sections[si].questions[qi];
          const display = c.answerKey[n++].correct[0];
          expect(q.options[c.table.optionOrder[q.index][display]].correct).toBe(true);
        }
      });
      expect(n).toBe(qs.length);
    }
  });

  it("renders the same table to the same text (re-derivable from the committee bundle)", () => {
    const t = variantTable(p, SECRET, "centre-C", r.centres["centre-C"].table.attempt);
    expect(renderCopy(p, t).text).toBe(r.centres["centre-C"].text);
  });
});
