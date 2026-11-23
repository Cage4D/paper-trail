import { useEffect, useRef, useState } from 'react';
import { hmsParts, utcDateTime, utcTime } from '../lib/format';
import { useNow } from '../lib/hooks';

/** Seconds until `startTime`, corrected by the server clock offset (serverNow - clientNow). */
export function useSecondsUntil(startTime: string | undefined, offsetMs = 0): number | null {
  const now = useNow(250);
  if (!startTime) return null;
  return (new Date(startTime).getTime() - (now + offsetMs)) / 1000;
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * One split-flap digit. When the value changes, the top half of the old digit folds down to show
 * the new one (~280 ms); unchanged digits never move. Reduced motion: the digit swaps instantly.
 */
export function FlipDigit({ d }: { d: string }) {
  const [shown, setShown] = useState(d);
  const [from, setFrom] = useState<string | null>(null);
  const flipId = useRef(0);
  useEffect(() => {
    if (d === shown) return;
    if (!reducedMotion()) {
      setFrom(shown);
      flipId.current++;
    }
    setShown(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  return (
    <span className="pt-flip" aria-hidden>
      <span className="pt-flip__half pt-flip__top">
        <span>{shown}</span>
      </span>
      <span className="pt-flip__half pt-flip__bottom">
        <span>{from ?? shown}</span>
      </span>
      {from !== null && (
        <>
          <span key={`o${flipId.current}`} className="pt-flip__half pt-flip__top pt-flip__flap pt-flip__flap--out">
            <span>{from}</span>
          </span>
          <span key={`i${flipId.current}`} className="pt-flip__half pt-flip__bottom pt-flip__flap pt-flip__flap--in" onAnimationEnd={() => setFrom(null)}>
            <span>{shown}</span>
          </span>
        </>
      )}
    </span>
  );
}

function FlipClock({ parts }: { parts: [string, string, string] }) {
  return (
    <div className="pt-flips" aria-hidden>
      {parts.map((p, i) => (
        <span key={i} className="pt-flips__pair">
          {i > 0 && <span className="pt-flips__sep">:</span>}
          <FlipDigit d={p[0]} />
          <FlipDigit d={p[1]} />
        </span>
      ))}
    </div>
  );
}

/** Countdown to the server's start time as a flip clock. White before zero, highlight ("live") at or after it. */
export function Countdown({ startTime, offsetMs = 0, compact = false, longDate = false }: { startTime: string; offsetMs?: number; compact?: boolean; longDate?: boolean }) {
  const left = useSecondsUntil(startTime, offsetMs) ?? 0;
  const live = left <= 0;
  const parts = hmsParts(Math.ceil(left));
  const wasLive = useRef(live);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (live && !wasLive.current) setAnnounce('Start time reached. The paper can now be released.');
    wasLive.current = live;
  }, [live]);
  return (
    <div className={`pt-count${live ? ' pt-count--live' : ''}${compact ? ' pt-count--compact' : ''}`} role="timer" aria-live="off" aria-label={live ? 'Start time reached' : `Paper opens in ${parts.join(':')}`}>
      <span className="pt-count__label">{live ? 'Start time reached' : 'Paper opens in'}</span>
      <FlipClock parts={parts} />
      {!compact && <span className="pt-count__at">{longDate ? utcDateTime(startTime) : `start ${utcTime(startTime)}`}</span>}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
