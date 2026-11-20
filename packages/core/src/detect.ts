/**
 * Leak detection (spec §4.3): which copy did a leaked text come from?
 *
 *  1. Normalise (case, accents, punctuation, whitespace) and segment into question chunks
 *     ("Q3:", "3.", "Question 3)" … or paragraphs when there are no markers).
 *  2. Align each chunk to a canonical question by token Jaccard (≥ 0.5), comparing against
 *     the question's fixed words plus whichever toggle words the chunk contains. Options
 *     are aligned the same way.
 *  3. Read fingerprint bits: the relative order of aligned questions within a section, the
 *     relative order of aligned options, and every toggle whose chosen alternative is
 *     visible.
 *  4. Compare against every copy's fingerprint table; the copy with the fewest mismatches wins.
 *
 * Runs on a committee member's client (or the demo bot): it needs the paper and the tables
 * from the committee bundle.
 */
import { allQuestions, bitLayout, fingerprintBits, type FingerprintTable, type Paper, type Part, type Question } from "./paper.js";

export interface LeakMatch {
  /** "master" or a centre id; null when nothing in the text could be aligned. */
  copy: string | null;
  /** 0..1: agreement with the best copy, scaled by its margin over the runner-up. */
  confidence: number;
  /** Observed bits that agree with the best copy. */
  matchedBits: number;
  observedBits: number;
  /** Runner-up mismatches minus best mismatches. */
  distanceToRunnerUp: number;
  ranking: { copy: string; mismatches: number }[];
  alignedQuestions: number[];
}

export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
const tokens = (s: string) => new Set(normalize(s).split(" ").filter(Boolean));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Canonical tokens of a text with toggles: the fixed words plus the toggle words seen in `seen`. */
function canonicalTokens(parts: Part[], seen: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const p of parts) {
    if (typeof p === "string") for (const t of tokens(p)) out.add(t);
    else for (const alt of p) for (const t of tokens(alt)) if (seen.has(t)) out.add(t);
  }
  return out;
}

/** Which alternative of a toggle `text` shows: 0, 1, or undefined when not decidable. */
function readToggle(alt: [string, string], text: string): boolean | undefined {
  const t = ` ${normalize(text)} `;
  const a = normalize(alt[0]);
  const b = normalize(alt[1]);
  const fa = a !== "" && t.includes(` ${a} `);
  const fb = b !== "" && t.includes(` ${b} `);
  if (fa && fb) {
    if (b.includes(a)) return true; // the longer alternative contains the shorter one
    if (a.includes(b)) return false;
    return undefined;
  }
  return fa ? false : fb ? true : undefined;
}

// ── segmentation ──

const Q_START = /^\s*(?:q(?:uestion)?\s*\d*\s*[:.)\]-]|\d{1,3}\s*[.):])\s*/i;
const OPT = /^\s*(?:[-*•–]\s*(?:\[[ xX]?\]\s*)?|\[[ xX]?\]\s*|\(?[a-dA-D1-4][.)]\s+)/;

interface Chunk {
  stem: string;
  options: string[];
}

function segment(text: string): Chunk[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const starts = lines.map((l) => Q_START.test(l));
  const groups: string[][] = [];
  if (starts.some(Boolean)) {
    let cur: string[] | undefined;
    lines.forEach((l, i) => {
      if (starts[i]) groups.push((cur = [l.replace(Q_START, "")]));
      else if (cur && l.trim()) cur.push(l);
    });
  } else {
    let cur: string[] = [];
    for (const l of lines) {
      if (l.trim()) cur.push(l);
      else if (cur.length) groups.push(cur), (cur = []);
    }
    if (cur.length) groups.push(cur);
  }
  return groups.map((g) => {
    const opts = g.slice(1).filter((l) => OPT.test(l));
    const stemLines = [g[0], ...g.slice(1).filter((l) => !OPT.test(l))];
    return opts.length
      ? { stem: stemLines.join(" "), options: opts.map((l) => l.replace(OPT, "")) }
      : { stem: g[0], options: g.slice(1) };
  });
}

function assign(scores: { i: number; j: number; s: number }[], threshold: number): Map<number, number> {
  const out = new Map<number, number>();
  const usedJ = new Set<number>();
  for (const x of scores.filter((x) => x.s >= threshold).sort((a, b) => b.s - a.s)) {
    if (out.has(x.i) || usedJ.has(x.j)) continue;
    out.set(x.i, x.j);
    usedJ.add(x.j);
  }
  return out;
}

// ── matching ──

export function matchLeak(text: string, paper: Paper, tables: FingerprintTable[]): LeakMatch {
  const qs = allQuestions(paper);
  const where = new Map<number, { section: number; local: number }>();
  paper.sections.forEach((s, si) => s.questions.forEach((q, li) => where.set(q.index, { section: si, local: li })));
  // toggle numbering in canonical reading order
  const toggleBase = new Map<number, number>();
  let tc = 0;
  for (const q of qs) {
    toggleBase.set(q.index, tc);
    for (const ps of [q.stem, ...q.options.map((o) => o.parts)]) tc += ps.filter((p) => typeof p !== "string").length;
  }
  const layout = bitLayout(paper);
  const indexOf = new Map(layout.map((r, i) => [JSON.stringify(r), i]));

  const chunks = segment(text);
  const qScores: { i: number; j: number; s: number }[] = [];
  chunks.forEach((c, i) => {
    const seen = tokens(c.stem);
    for (const q of qs) qScores.push({ i, j: q.index, s: jaccard(seen, canonicalTokens(q.stem, seen)) });
  });
  const aligned = assign(qScores, 0.5); // chunk index → question index
  const observed = new Map<number, boolean>();
  const order = [...aligned.entries()].sort((a, b) => a[0] - b[0]).map(([, q]) => q);

  // question order within sections
  for (let x = 0; x < order.length; x++)
    for (let y = x + 1; y < order.length; y++) {
      const a = where.get(order[x])!;
      const b = where.get(order[y])!;
      if (a.section !== b.section) continue;
      const [lo, hi] = a.local < b.local ? [a.local, b.local] : [b.local, a.local];
      const bit = indexOf.get(JSON.stringify({ kind: "q", section: a.section, a: lo, b: hi }))!;
      observed.set(bit, b.local < a.local); // "hi shown before lo"
    }

  for (const [ci, qi] of aligned) {
    const q: Question = qs[qi];
    const c = chunks[ci];
    // options
    const oScores: { i: number; j: number; s: number }[] = [];
    c.options.forEach((o, i) => {
      const seen = tokens(o);
      q.options.forEach((opt, j) => oScores.push({ i, j, s: jaccard(seen, canonicalTokens(opt.parts, seen)) }));
    });
    const oAligned = assign(oScores, 0.5);
    const oOrder = [...oAligned.entries()].sort((a, b) => a[0] - b[0]).map(([, j]) => j);
    for (let x = 0; x < oOrder.length; x++)
      for (let y = x + 1; y < oOrder.length; y++) {
        const [lo, hi] = oOrder[x] < oOrder[y] ? [oOrder[x], oOrder[y]] : [oOrder[y], oOrder[x]];
        const bit = indexOf.get(JSON.stringify({ kind: "o", question: q.index, a: lo, b: hi }))!;
        observed.set(bit, oOrder[y] < oOrder[x]);
      }
    // toggles
    let t = toggleBase.get(q.index)!;
    const readParts = (parts: Part[], where: string | undefined) => {
      for (const p of parts) {
        if (typeof p === "string") continue;
        const v = where === undefined ? undefined : readToggle(p, where);
        if (v !== undefined) observed.set(indexOf.get(JSON.stringify({ kind: "t", toggle: t }))!, v);
        t++;
      }
    };
    readParts(q.stem, c.stem);
    const optionText = new Map([...oAligned.entries()].map(([i, j]) => [j, c.options[i]]));
    q.options.forEach((o, j) => readParts(o.parts, optionText.get(j)));
  }

  const ranking = tables
    .map((tb) => {
      const bits = fingerprintBits(paper, tb, layout);
      let mm = 0;
      for (const [i, v] of observed) if (bits[i] !== v) mm++;
      return { copy: tb.copy, mismatches: mm };
    })
    .sort((a, b) => a.mismatches - b.mismatches);
  const n = observed.size;
  if (!n || !ranking.length) return { copy: null, confidence: 0, matchedBits: 0, observedBits: n, distanceToRunnerUp: 0, ranking, alignedQuestions: order };
  const best = ranking[0];
  const margin = ranking.length > 1 ? ranking[1].mismatches - best.mismatches : n;
  const agreement = 1 - best.mismatches / n;
  const confidence = Math.max(0, Math.min(1, agreement * Math.min(1, margin / Math.max(1, n / 4))));
  return { copy: best.copy, confidence, matchedBits: n - best.mismatches, observedBits: n, distanceToRunnerUp: margin, ranking, alignedQuestions: order };
}
