import { describe, expect, it } from 'vitest';
import { diffWords, parseCopy } from '../src/lib/paper';
import { humaniseIsoTimes, shortHash } from '../src/lib/format';

const COPY = `# Demo Board — Mock

## Section A: Physics

Answer every question.

Q1: A car speeds up uniformly. Find its acceleration?
- [ ] 5 m/s²
- [ ] 80 m/s²

Q2: Which particle carries a negative charge?
- [ ] Electron
- [ ] Proton

## Section B: Biology

Q3: Which organelle releases energy?
- [ ] Nucleus
- [ ] Mitochondrion
`;

describe('parseCopy', () => {
  it('reads title, sections, intro, global numbers and per-section positions', () => {
    const p = parseCopy(COPY);
    expect(p.title).toBe('Demo Board — Mock');
    expect(p.sections.map((s) => s.heading)).toEqual(['Section A: Physics', 'Section B: Biology']);
    expect(p.sections[0].intro).toBe('Answer every question.');
    expect(p.sections[1].questions[0]).toMatchObject({ number: 3, position: 1, stem: 'Which organelle releases energy?', options: ['Nucleus', 'Mitochondrion'] });
  });
});

describe('diffWords', () => {
  it('marks only the differing words, merged into runs', () => {
    const d = diffWords('A car speeds up uniformly. Find its acceleration?', 'A car accelerates uniformly. What is its acceleration?');
    expect(d.filter((t) => t.changed).map((t) => t.text.trim())).toEqual(['speeds up', 'Find']);
    expect(d.map((t) => t.text).join('')).toBe('A car speeds up uniformly. Find its acceleration?');
  });
  it('reports nothing changed for identical text', () => {
    expect(diffWords('same words here', 'same words here').some((t) => t.changed)).toBe(false);
  });
});

describe('format', () => {
  it('shortens hashes and qor1 addresses', () => {
    expect(shortHash('0xbe6b208Bc8990a68740053Dad68624914812cf8F')).toBe('0xbe6b…cf8F');
    expect(shortHash('qor1he4jpz7gny9xsaqq20dddp3yj9yp9nu0pxscg9')).toBe('qor1he4j…scg9');
  });
  it('turns ISO times in catalog messages into UTC clock times', () => {
    expect(humaniseIsoTimes('It can be released from 2026-11-23T14:52:30.000Z.')).toBe('It can be released from 14:52:30 UTC.');
  });
});
