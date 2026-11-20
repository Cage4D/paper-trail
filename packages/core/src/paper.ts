/**
 * Papers and canary copies (spec §4.1).
 *
 * Format (Markdown):
 *   # Title
 *   ## Section heading
 *   optional section intro lines
 *   Q: question stem (may span lines; may contain toggles {{a|b}})
 *   - [ ] option
 *   - [x] correct option
 *
 * Copies: the MASTER copy (canonical order, every toggle = first alternative) plus one
 * variant per centre. A variant's seed is HKDF-SHA3-256(examSecret, "papertrail:variant:" +
 * centreId + ":" + attempt). The seed drives a SHAKE256 stream (@qorechain/pqc), which drives
 * Fisher–Yates question order within each section, option order within each question, and
 * the toggle bits. The distributed text carries no answer marks; answer keys are remapped
 * per copy.
 *
 * Fingerprint = a bit vector:
 *   - for every pair of questions in a section, "is b shown before a";
 *   - for every pair of options in a question, the same;
 *   - every toggle bit.
 * Distance rule: every pair of copies (the master included) differs in ≥ 20 fingerprint bits.
 * A copy's seed is re-drawn (attempt + 1) until it does, up to 1,000 times; otherwise the
 * result carries a warning asking the examiner to add toggles.
 */
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { shake256 } from "@qorechain/pqc";
import { concat, sha3Hex, utf8 } from "./util.js";

// ── model ──

/** A text with toggles: alternating literal parts and [a, b] alternatives. */
export type Part = string | [string, string];

export interface Option {
  parts: Part[];
  correct: boolean;
}
export interface Question {
  /** Global canonical index. */
  index: number;
  stem: Part[];
  options: Option[];
}
export interface Section {
  heading: string;
  intro: string;
  questions: Question[];
}
export interface Paper {
  title: string;
  sections: Section[];
  /** Total toggles, in reading order (stem then options, question by question). */
  toggleCount: number;
}

export interface FingerprintTable {
  copy: string; // "master" or the centre id
  attempt: number;
  /** Per section: canonical question indices (within the section) in display order. */
  questionOrder: number[][];
  /** Per global question index: canonical option indices in display order. */
  optionOrder: number[][];
  /** One bit per toggle (false = first alternative). */
  toggles: boolean[];
}

export interface RenderedCopy {
  table: FingerprintTable;
  text: string;
  /** SHA3-256 of the UTF-8 bytes of `text` (0x hex), the on-chain commitment. */
  commitment: `0x${string}`;
  /** Display-order answer key: per displayed question, the displayed indices of correct options. */
  answerKey: { number: number; section: number; correct: number[] }[];
}

// ── parsing ──

function parseParts(s: string): Part[] {
  const parts: Part[] = [];
  const re = /\{\{([^{}|]*)\|([^{}|]*)\}\}/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    parts.push([m[1], m[2]]);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  if (/\{\{|\}\}/.test(parts.filter((p) => typeof p === "string").join(""))) throw new Error(`malformed toggle in: ${s}`);
  return parts;
}

export function parsePaper(markdown: string): Paper {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let title = "";
  const sections: Section[] = [];
  let section: Section | undefined;
  let q: { stem: string[]; options: Option[] } | undefined;
  let index = 0;
  const flush = () => {
    if (!q) return;
    if (!section) throw new Error("question before the first section heading (##)");
    if (q.options.length < 2) throw new Error(`question ${index + 1} needs at least 2 options`);
    if (!q.options.some((o) => o.correct)) throw new Error(`question ${index + 1} has no correct option`);
    section.questions.push({ index: index++, stem: parseParts(q.stem.join("\n").trim()), options: q.options });
    q = undefined;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#\s+/.test(line) && !/^##/.test(line)) {
      flush();
      title = line.replace(/^#\s+/, "").trim();
    } else if (/^##\s+/.test(line)) {
      flush();
      section = { heading: line.replace(/^##\s+/, "").trim(), intro: "", questions: [] };
      sections.push(section);
    } else if (/^Q:\s*/.test(line)) {
      flush();
      q = { stem: [line.replace(/^Q:\s*/, "")], options: [] };
    } else if (/^- \[( |x|X)\]\s+/.test(line)) {
      if (!q) throw new Error(`option outside a question: ${line}`);
      const correct = /^- \[(x|X)\]/.test(line);
      q.options.push({ parts: parseParts(line.replace(/^- \[( |x|X)\]\s+/, "")), correct });
    } else if (q && q.options.length === 0 && line.trim() !== "") {
      q.stem.push(line);
    } else if (q && line.trim() === "") {
      // blank line inside / after a question: ignored
    } else if (!q && section && line.trim() !== "") {
      section.intro += (section.intro ? "\n" : "") + line;
    } else if (line.trim() !== "" && !section) {
      throw new Error(`text before the first section: ${line}`);
    } else if (q && q.options.length > 0 && line.trim() !== "") {
      throw new Error(`unexpected line after options: ${line}`);
    }
  }
  flush();
  if (!sections.length || !sections.some((s) => s.questions.length)) throw new Error("paper has no questions");
  let toggleCount = 0;
  for (const s of sections) for (const qq of s.questions) toggleCount += countToggles(qq);
  return { title, sections, toggleCount };
}

const countToggles = (q: Question) => [q.stem, ...q.options.map((o) => o.parts)].reduce((n, ps) => n + ps.filter((p) => typeof p !== "string").length, 0);
export const allQuestions = (p: Paper) => p.sections.flatMap((s) => s.questions);

// ── seeded randomness ──

/** Deterministic stream: SHAKE256(seed ‖ "papertrail:prng:v1" ‖ u32 block), 1 KiB blocks. */
class Stream {
  private buf: Uint8Array = new Uint8Array(0);
  private pos = 0;
  private block = 0;
  constructor(private readonly seed: Uint8Array) {}
  private byte(): number {
    if (this.pos >= this.buf.length) {
      const ctr = new Uint8Array(4);
      new DataView(ctr.buffer).setUint32(0, this.block++);
      this.buf = shake256(concat(this.seed, utf8("papertrail:prng:v1"), ctr), 1024);
      this.pos = 0;
    }
    return this.buf[this.pos++];
  }
  u32(): number {
    return ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
  }
  /** Uniform integer in [0, n) by rejection sampling. */
  below(n: number): number {
    const limit = Math.floor(0x100000000 / n) * n;
    for (;;) {
      const x = this.u32();
      if (x < limit) return x % n;
    }
  }
  bit(): boolean {
    return (this.byte() & 1) === 1;
  }
  shuffle(n: number): number[] {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = this.below(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

export function variantSeed(examSecret: Uint8Array, copyId: string, attempt: number): Uint8Array {
  return hkdf(sha3_256, examSecret, undefined, utf8(`papertrail:variant:${copyId}:${attempt}`), 32);
}

export function masterTable(paper: Paper): FingerprintTable {
  return {
    copy: "master",
    attempt: 0,
    questionOrder: paper.sections.map((s) => s.questions.map((_, i) => i)),
    optionOrder: allQuestions(paper).map((q) => q.options.map((_, i) => i)),
    toggles: new Array(paper.toggleCount).fill(false),
  };
}

export function variantTable(paper: Paper, examSecret: Uint8Array, copyId: string, attempt: number): FingerprintTable {
  const st = new Stream(variantSeed(examSecret, copyId, attempt));
  const questionOrder = paper.sections.map((s) => st.shuffle(s.questions.length));
  const optionOrder = allQuestions(paper).map((q) => st.shuffle(q.options.length));
  const toggles = Array.from({ length: paper.toggleCount }, () => st.bit());
  return { copy: copyId, attempt, questionOrder, optionOrder, toggles };
}

// ── fingerprints ──

export type BitRef = { kind: "q"; section: number; a: number; b: number } | { kind: "o"; question: number; a: number; b: number } | { kind: "t"; toggle: number };

/** The meaning of each fingerprint bit, in order. */
export function bitLayout(paper: Paper): BitRef[] {
  const out: BitRef[] = [];
  paper.sections.forEach((s, si) => {
    for (let a = 0; a < s.questions.length; a++) for (let b = a + 1; b < s.questions.length; b++) out.push({ kind: "q", section: si, a, b });
  });
  for (const q of allQuestions(paper)) for (let a = 0; a < q.options.length; a++) for (let b = a + 1; b < q.options.length; b++) out.push({ kind: "o", question: q.index, a, b });
  for (let t = 0; t < paper.toggleCount; t++) out.push({ kind: "t", toggle: t });
  return out;
}

const before = (order: number[], a: number, b: number) => order.indexOf(b) < order.indexOf(a);

export function fingerprintBits(paper: Paper, t: FingerprintTable, layout = bitLayout(paper)): boolean[] {
  return layout.map((r) => (r.kind === "q" ? before(t.questionOrder[r.section], r.a, r.b) : r.kind === "o" ? before(t.optionOrder[r.question], r.a, r.b) : t.toggles[r.toggle]));
}

export function fingerprintDistance(a: boolean[], b: boolean[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** Spec §6 name: the fingerprint table of one copy. */
export function fingerprintTable(c: RenderedCopy): FingerprintTable {
  return c.table;
}

// ── rendering ──

function partsText(parts: Part[], toggles: boolean[], cursor: { t: number }): string {
  return parts.map((p) => (typeof p === "string" ? p : p[toggles[cursor.t++] ? 1 : 0])).join("");
}

/** Canonical text of a copy (no answer marks). LF line endings, one trailing newline. */
export function renderCopy(paper: Paper, t: FingerprintTable): RenderedCopy {
  // toggle numbering is by canonical reading order, so resolve each question's texts canonically first
  const cursor = { t: 0 };
  const resolved = new Map<number, { stem: string; options: string[] }>();
  for (const q of allQuestions(paper)) resolved.set(q.index, { stem: partsText(q.stem, t.toggles, cursor), options: q.options.map((o) => partsText(o.parts, t.toggles, cursor)) });

  const out: string[] = [];
  if (paper.title) out.push(`# ${paper.title}`, "");
  const answerKey: RenderedCopy["answerKey"] = [];
  let number = 0;
  paper.sections.forEach((s, si) => {
    out.push(`## ${s.heading}`, "");
    if (s.intro) out.push(s.intro, "");
    for (const qi of t.questionOrder[si]) {
      const q = s.questions[qi];
      const r = resolved.get(q.index)!;
      number++;
      out.push(`Q${number}: ${r.stem}`);
      const order = t.optionOrder[q.index];
      order.forEach((oi) => out.push(`- [ ] ${r.options[oi]}`));
      out.push("");
      answerKey.push({ number, section: si, correct: order.flatMap((oi, display) => (q.options[oi].correct ? [display] : [])) });
    }
  });
  const text = out.join("\n").replace(/\n+$/, "") + "\n";
  return { table: t, text, commitment: commitmentOf(text), answerKey };
}

export function commitmentOf(text: string): `0x${string}` {
  return sha3Hex(utf8(text));
}

// ── generation with the distance rule ──

export interface CopiesResult {
  master: RenderedCopy;
  centres: Record<string, RenderedCopy>;
  /** Fingerprint tables of every copy (master first): part of the committee bundle. */
  tables: FingerprintTable[];
  /** Smallest fingerprint distance between any two copies. */
  minPairDistance: number;
  /** Set when the distance rule could not be met: ask the examiner to add toggles. */
  warning?: string;
}

export function generateCopies(paper: Paper, examSecret: Uint8Array, centreIds: string[], opts: { minDistance?: number; maxAttempts?: number } = {}): CopiesResult {
  const minDistance = opts.minDistance ?? 20;
  const maxAttempts = opts.maxAttempts ?? 1000;
  if (new Set(centreIds).size !== centreIds.length || centreIds.includes("master")) throw new Error("centre ids must be distinct and not 'master'");
  const layout = bitLayout(paper);
  const master = masterTable(paper);
  const accepted: { t: FingerprintTable; bits: boolean[] }[] = [{ t: master, bits: fingerprintBits(paper, master, layout) }];
  let warning: string | undefined;
  for (const id of centreIds) {
    let best: { t: FingerprintTable; bits: boolean[]; d: number } | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const t = variantTable(paper, examSecret, id, attempt);
      const bits = fingerprintBits(paper, t, layout);
      const d = Math.min(...accepted.map((x) => fingerprintDistance(bits, x.bits)));
      if (!best || d > best.d) best = { t, bits, d };
      if (d >= minDistance) break;
    }
    if (best!.d < minDistance) warning = `Copies could not all be kept ${minDistance} fingerprint bits apart (closest pair: ${best!.d}). Add more {{a|b}} toggles or questions.`;
    accepted.push({ t: best!.t, bits: best!.bits });
  }
  let minPairDistance = Infinity;
  for (let i = 0; i < accepted.length; i++) for (let j = i + 1; j < accepted.length; j++) minPairDistance = Math.min(minPairDistance, fingerprintDistance(accepted[i].bits, accepted[j].bits));
  const centres: Record<string, RenderedCopy> = {};
  for (const x of accepted.slice(1)) centres[x.t.copy] = renderCopy(paper, x.t);
  return { master: renderCopy(paper, master), centres, tables: accepted.map((x) => x.t), minPairDistance, ...(warning ? { warning } : {}) };
}
