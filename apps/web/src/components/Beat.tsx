import type { ReactNode } from 'react';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import type { BeatState } from '../lib/demoState';

type Props = {
  n: number;
  state: BeatState;
  title: string;
  /** Right side of the header: a status chip or a muted hint. */
  aside?: ReactNode;
  /** Pending: the one muted line saying what will happen. Collapsed: the one-line summary. */
  line?: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
  children?: ReactNode;
};

/** One stepper item: numbered circle + card. Pending cards are dashed and compact. */
export function Beat({ n, state, title, aside, line, collapsed, onToggle, toggleLabel, children }: Props) {
  const headingId = `b${n}-title`;
  const compact = state === 'pending' || collapsed;
  return (
    <li id={`b${n}`} className={`pt-beat pt-beat--${state}${collapsed ? ' pt-beat--collapsed' : ''}`}>
      <span className="pt-beat__num" aria-hidden>
        {n}
      </span>
      <article className="pt-beat__card" aria-labelledby={headingId}>
        <div className="pt-beat__head">
          <h2 id={headingId} className={compact ? 'pt-h3' : 'pt-h2'}>
            <span className="sr-only">Beat {n}: </span>
            {title}
          </h2>
          <span className="pt-beat__aside">
            {aside}
            {onToggle && (state === 'done' || state === 'refused') && (
              <button type="button" className="pt-btn pt-btn--ghost pt-btn--sm" aria-expanded={!collapsed} aria-controls={`b${n}-body`} onClick={onToggle}>
                {collapsed ? toggleLabel ?? 'Show' : 'Hide'}
                {collapsed ? <IconChevronDown size={16} stroke={2} aria-hidden /> : <IconChevronUp size={16} stroke={2} aria-hidden />}
              </button>
            )}
          </span>
        </div>
        {compact && line && <p className="pt-beat__line">{line}</p>}
        {!compact && (
          <div id={`b${n}-body`} className="pt-beat__body">
            {children}
          </div>
        )}
      </article>
    </li>
  );
}

/** Skeleton beat for the first load: sunk fill, no text. */
export function BeatSkeleton({ n }: { n: number }) {
  return (
    <li className="pt-beat pt-beat--pending" aria-hidden>
      <span className="pt-beat__num">{n}</span>
      <div className="pt-beat__card pt-skelcard">
        <div className="pt-skel pt-skel--title" />
        <div className="pt-skel pt-skel--line" />
      </div>
    </li>
  );
}
