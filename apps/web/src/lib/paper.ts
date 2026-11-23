// Parsing of rendered paper copies ("# Title", "## Section", intro, "Qn: stem", "- [ ] option")
// and a small word diff, for the canary diff in judge mode (design handoff §7, beat 1).

export interface CopyQuestion {
  number: number; // displayed number (global across sections)
  position: number; // 1-based position within its section
  stem: string;
  options: string[];
}
export interface CopySection {
  heading: string;
  intro: string;
  questions: CopyQuestion[];
}
export interface ParsedCopy {
  title: string;
  sections: CopySection[];
}

export function parseCopy(text: string): ParsedCopy {
  const out: ParsedCopy = { title: '', sections: [] };
  let section: CopySection | undefined;
  let q: CopyQuestion | undefined;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#\s+(.*)$/))) out.title = m[1].trim();
    else if ((m = line.match(/^##\s+(.*)$/))) {
      section = { heading: m[1].trim(), intro: '', questions: [] };
      out.sections.push(section);
      q = undefined;
    } else if ((m = line.match(/^Q(\d*):\s*(.*)$/)) && section) {
      q = { number: 0, position: section.questions.length + 1, stem: m[2], options: [] };
      section.questions.push(q);
    } else if ((m = line.match(/^- \[[ xX]\]\s+(.*)$/)) && q) q.options.push(m[1]);
    else if (line.trim() && section && !q) section.intro += (section.intro ? '\n' : '') + line.trim();
    else if (line.trim() && q && !q.options.length) q.stem += ` ${line.trim()}`;
  }
  let n = 0;
  for (const s of out.sections) for (const qq of s.questions) qq.number = ++n;
  return out;
}

export type DiffToken = { text: string; changed: boolean };

/**
 * Word-level diff of `a` against `b`: tokens of `a` that are not in the longest common subsequence
 * are marked `changed`. Whitespace is kept attached so the text re-joins exactly.
 */
export function diffWords(a: string, b: string): DiffToken[] {
  const ta = a.match(/\S+\s*/g) ?? [];
  const tb = b.match(/\S+\s*/g) ?? [];
  const norm = (t: string) => t.trim().toLowerCase().replace(/[.,;:?!]+$/, '');
  const na = ta.map(norm);
  const nb = tb.map(norm);
  const L = Array.from({ length: na.length + 1 }, () => new Array<number>(nb.length + 1).fill(0));
  for (let i = na.length - 1; i >= 0; i--) for (let j = nb.length - 1; j >= 0; j--) L[i][j] = na[i] === nb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const keep = new Array<boolean>(na.length).fill(false);
  for (let i = 0, j = 0; i < na.length && j < nb.length; ) {
    if (na[i] === nb[j]) {
      keep[i] = true;
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  // merge consecutive changed tokens into one highlight
  const out: DiffToken[] = [];
  ta.forEach((t, i) => {
    const changed = !keep[i];
    const prev = out[out.length - 1];
    if (prev && prev.changed === changed) prev.text += t;
    else out.push({ text: t, changed });
  });
  return out;
}
