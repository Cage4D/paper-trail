/**
 * Simulated leaks for judge mode and the detector tests: k questions of a copy (kept in that
 * copy's order), retyped with realistic noise (case, punctuation, doubled spaces, a typo in the
 * stem, different numbering and bullet styles, an occasional dropped option). Deterministic for
 * a given seed.
 */
export function leakRng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(a: T[]) => a[Math.floor(next() * a.length)] };
}

export function simulateLeak(copyText: string, k: number, seed: number): string {
  const r = leakRng(seed);
  const blocks = copyText.split(/\n(?=Q\d+:)/).filter((b) => /^Q\d+:/.test(b));
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
      const words = stem.split(" ");
      const idx = words.map((w, i) => (w.length > 4 ? i : -1)).filter((i) => i >= 0);
      if (idx.length) {
        const w = words[r.pick(idx)];
        words[words.indexOf(w)] = w.slice(0, 2) + w[3] + w[2] + w.slice(4);
        stem = words.join(" ");
      }
    }
    out.push(r.pick([`Q${n + 1}: `, `${n + 1}. `, `Question ${n + 1}) `, `Q: `]) + noisy(stem));
    const style = r.int(3);
    options.forEach((o, oi) => {
      if (r.next() < 0.1) return;
      out.push((style === 0 ? "- [ ] " : style === 1 ? `${"abcd"[oi]}) ` : "* ") + noisy(o));
    });
    out.push("");
  });
  return out.join("\n");
}
