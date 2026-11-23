import { Fragment, useMemo, useState } from 'react';
import { diffWords, parseCopy, type CopyQuestion, type ParsedCopy } from '../lib/paper';
import type { DemoVariants, QuestionDiff } from '../lib/types';
import { HashLink } from './HashLink';
import { StickyNote } from './StickyNote';

type Side = 'A' | 'B';

interface Row {
  q: CopyQuestion;
  other: CopyQuestion | undefined;
  diff: QuestionDiff | undefined;
  moved: boolean;
}

function rows(side: Side, mine: ParsedCopy, theirs: ParsedCopy, diffs: QuestionDiff[]): Row[][] {
  const pos = (d: QuestionDiff, s: Side) => (s === 'A' ? d.positionA : d.positionB);
  const other: Side = side === 'A' ? 'B' : 'A';
  return mine.sections.map((sec, si) => {
    const inSec = diffs.filter((d) => d.section === si + 1);
    // the single biggest move in the section gets the pale-yellow row in both sheets
    const biggest = inSec.reduce<QuestionDiff | undefined>((m, d) => (!m || Math.abs(d.positionA - d.positionB) > Math.abs(m.positionA - m.positionB) ? d : m), undefined);
    const maxMove = biggest ? Math.abs(biggest.positionA - biggest.positionB) : 0;
    return sec.questions.map((q) => {
      const d = inSec.find((x) => pos(x, side) === q.position);
      const o = d ? theirs.sections[si]?.questions.find((x) => x.position === pos(d, other)) : undefined;
      return { q, other: o, diff: d, moved: !!d && maxMove >= 2 && d === biggest };
    });
  });
}

function Words({ a, b }: { a: string; b: string | undefined }) {
  if (b === undefined) return <>{a}</>;
  return (
    <>
      {diffWords(a, b).map((t, i) =>
        t.changed ? (
          <Fragment key={i}>
            <mark className="pt-tog">{t.text.trimEnd()}</mark>
            {t.text.slice(t.text.trimEnd().length)}
          </Fragment>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </>
  );
}

function Sheet({ side, data, show }: { side: Side; data: Row[][]; show: number }) {
  const other = side === 'A' ? 'B' : 'A';
  let shown = 0;
  return (
    <div className="pt-sheet" aria-label={`Centre ${side}'s copy`}>
      {data.map((sec, si) => {
        if (shown >= show) return null;
        const items = sec.slice(0, Math.max(0, show - shown));
        shown += items.length;
        return (
          <div key={si} className="pt-col" style={{ gap: 12 }}>
            <div className="pt-sheet__head">
              <strong className="pt-sheet__title">{si === 0 ? `Centre ${side}` : ''}</strong>
              <span className="pt-sheet__sec">Section {String.fromCharCode(65 + si)}</span>
            </div>
            {items.map(({ q, other: o, moved, diff }) => (
              <div key={q.number} className={`pt-q${moved ? ' pt-q--moved' : ''}`}>
                <span className="pt-q__n">Q{q.number}</span>
                <div>
                  <Words a={q.stem} b={o?.stem} />
                  {o && <span className="pt-move">Q{o.number} in {other}</span>}
                  <ul className="pt-q__opts">
                    {q.options.map((opt, oi) => {
                      // match the option by its canonical index in the other copy
                      const canon = diff ? (side === 'A' ? diff.optionOrderA : diff.optionOrderB)[oi] : undefined;
                      const theirOrder = diff ? (side === 'A' ? diff.optionOrderB : diff.optionOrderA) : undefined;
                      const j = canon !== undefined && theirOrder ? theirOrder.indexOf(canon) : -1;
                      return (
                        <li key={oi}>
                          <Words a={opt} b={j >= 0 ? o?.options[j] : undefined} />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Beat 1's canary diff: the same paper, two fingerprints. Sheets are always white paper. */
/** `spotNote`: show the "spot the difference" sticky note (judge mode, only while the paper is sealed). */
export function CanaryDiff({ variants, spotNote = false }: { variants: DemoVariants; spotNote?: boolean }) {
  const [all, setAll] = useState(false);
  const { A, total, moved, rowsA, rowsB } = useMemo(() => {
    const A = parseCopy(variants.A);
    const B = parseCopy(variants.B);
    const qs = variants.differences.questions;
    const moved = qs.filter((d) => d.positionA !== d.positionB || d.optionOrderA.join() !== d.optionOrderB.join()).length;
    return { A, B, total: qs.length, moved, rowsA: rows('A', A, B, qs), rowsB: rows('B', B, A, qs) };
  }, [variants]);
  const firstSection = A.sections[0]?.questions.length ?? 4;
  // the question that moved furthest between the two copies, as displayed numbers
  const spot = useMemo(() => {
    // Section A only: the sheets show the start of Section A until expanded, so the note points at visible questions
    const all = (rowsA[0] ?? []).filter((r) => r.other && r.diff);
    const best = all.reduce<(typeof all)[number] | undefined>((m, r) => (!m || Math.abs(r.diff!.positionA - r.diff!.positionB) > Math.abs(m.diff!.positionA - m.diff!.positionB) ? r : m), undefined);
    return best && best.q.number !== best.other!.number ? { a: best.q.number, b: best.other!.number } : null;
  }, [rowsA]);
  const show = all ? total : Math.min(4, firstSection);
  return (
    <div className="pt-canary">
      <div className="pt-canary__top">
        <div className="pt-canary__head">
          <h3 className="pt-h3">Canary copies: the same paper, two fingerprints</h3>
          <span className="pt-muted pt-small">No answers are marked on any copy.</span>
        </div>
        {spotNote && spot && (
          <StickyNote>
            Spot the difference: Q{spot.a} in Centre A is Q{spot.b} in Centre B. That's how a leak names its source.
          </StickyNote>
        )}
      </div>
      <div className="pt-stats">
        <div className="pt-stat">
          <div className="pt-stat__v">≥ {variants.minPairDistanceBits} bits</div>
          <div className="pt-stat__l">apart, between any two copies</div>
        </div>
        <div className="pt-stat">
          <div className="pt-stat__v">
            {variants.differences.togglesDiffer} of {variants.differences.toggles}
          </div>
          <div className="pt-stat__l">phrasing toggles differ, A vs B</div>
        </div>
        <div className="pt-stat">
          <div className="pt-stat__v">
            {moved} of {total}
          </div>
          <div className="pt-stat__l">questions moved or reshuffled</div>
        </div>
      </div>
      <div className="pt-diff">
        <Sheet side="A" data={rowsA} show={show} />
        <Sheet side="B" data={rowsB} show={show} />
      </div>
      <p className="pt-muted pt-small">
        Highlighted words are phrasing toggles that differ. Purple tags show where the same question sits in the other copy.
        {all ? '' : ' Showing the start of Section A.'}
      </p>
      <button type="button" className="pt-btn pt-btn--sm" style={{ alignSelf: 'flex-start' }} aria-expanded={all} onClick={() => setAll((x) => !x)}>
        {all ? 'Show fewer questions' : `Show all ${total} questions`}
      </button>
      <div className="pt-txlist">
        <HashLink value={variants.commitments.master} kind="plain" label="master commitment" small />
        <HashLink value={variants.commitments.A} kind="plain" label="A" small />
        <HashLink value={variants.commitments.B} kind="plain" label="B" small />
      </div>
    </div>
  );
}
