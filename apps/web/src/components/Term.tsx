import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { GLOSSARY, type GlossaryKey } from '../lib/glossary';

/** A word with a dotted underline: tap, click or focus it for a one-line plain-English meaning. */
export function Term({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const g = GLOSSARY[k];
  return (
    <span className="pt-term" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="pt-term__word" aria-expanded={open} aria-describedby={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
        {children ?? g.term.toLowerCase()}
      </button>
      {open && (
        <span id={id} role="tooltip" className="pt-term__tip">
          <strong>{g.term}:</strong> {g.def}
        </span>
      )}
    </span>
  );
}

/** The landing page's "Words explained" list. */
export function Glossary({ keys }: { keys?: GlossaryKey[] }) {
  const list = keys ?? (Object.keys(GLOSSARY) as GlossaryKey[]);
  return (
    <dl className="pt-glossary">
      {list.map((key) => (
        <div key={key} className="pt-glossary__item">
          <dt>{GLOSSARY[key].term}</dt>
          <dd>{GLOSSARY[key].def}</dd>
        </div>
      ))}
    </dl>
  );
}
