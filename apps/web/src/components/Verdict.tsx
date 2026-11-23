import type { ReactNode } from 'react';
import { IconCheck, IconChevronRight, IconX } from '@tabler/icons-react';

/** Big result block: sticker or icon, one large line, one detail line. */
export function Verdict({ tone, sticker, icon, title, children, big = true }: { tone: 'ok' | 'bad' | 'neutral'; sticker?: string; icon?: ReactNode; title: ReactNode; children?: ReactNode; big?: boolean }) {
  const ico = icon ?? (tone === 'ok' ? <IconCheck size={36} stroke={2.5} /> : tone === 'bad' ? <IconX size={36} stroke={2.5} /> : null);
  return (
    <div className={`pt-verdict pt-verdict--${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      {sticker ? <img src={sticker} alt="" aria-hidden="true" /> : ico && <span className="pt-verdict__icon" aria-hidden>{ico}</span>}
      <div className="pt-verdict__text">
        <p className={big ? 'pt-verdict__big' : 'pt-verdict__title'}>{title}</p>
        {children}
      </div>
    </div>
  );
}

/** ✓ / ✗ rows: mark, text, right-aligned code or tx. */
export function XRow({ yes, children, aside }: { yes: boolean; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className={`pt-xrow pt-xrow--${yes ? 'yes' : 'no'}`}>
      <span className="pt-xrow__mark" aria-hidden>
        {yes ? <IconCheck size={16} stroke={2.5} /> : <IconX size={16} stroke={2.5} />}
      </span>
      <span>
        <span className="sr-only">{yes ? 'Yes: ' : 'No: '}</span>
        {children}
      </span>
      {aside ? <span className="pt-xrow__aside">{aside}</span> : <span />}
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="pt-col" style={{ gap: 6 }}>
      <div className="pt-row" style={{ justifyContent: 'space-between' }}>
        <strong className="pt-small">Confidence</strong>
        <strong className="pt-small pt-mono">{pct}%</strong>
      </div>
      <div className="pt-conf" role="img" aria-label={`Confidence ${pct}%`}>
        <div className="pt-conf__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Collapsible "What happened on-chain": Called / Events / Auth / Result rows. */
export function OnChainDetails({ rows, summary = 'What happened on-chain' }: { rows: [string, ReactNode][]; summary?: string }) {
  return (
    <details className="pt-details">
      <summary>
        <IconChevronRight size={16} stroke={2} aria-hidden className="pt-details__chev" />
        {summary}
      </summary>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
