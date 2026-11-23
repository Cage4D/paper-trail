import { useEffect, useRef, useState } from 'react';
import { hmsParts, utcDateTime, utcTime } from '../lib/format';
import { useNow } from '../lib/hooks';

/** Seconds until `startTime`, corrected by the server clock offset (serverNow - clientNow). */
export function useSecondsUntil(startTime: string | undefined, offsetMs = 0): number | null {
  const now = useNow(250);
  if (!startTime) return null;
  return (new Date(startTime).getTime() - (now + offsetMs)) / 1000;
}

/** Countdown to the server's start time. White before zero, highlight ("live") at or after it. */
export function Countdown({ startTime, offsetMs = 0, compact = false, longDate = false }: { startTime: string; offsetMs?: number; compact?: boolean; longDate?: boolean }) {
  const left = useSecondsUntil(startTime, offsetMs) ?? 0;
  const live = left <= 0;
  const [h, m, s] = hmsParts(Math.ceil(left));
  const wasLive = useRef(live);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (live && !wasLive.current) setAnnounce('Start time reached. The paper can now be released.');
    wasLive.current = live;
  }, [live]);
  return (
    <div className={`pt-count${live ? ' pt-count--live' : ''}${compact ? ' pt-count--compact' : ''}`} role="timer" aria-live="off" aria-label={live ? 'Start time reached' : `Paper opens in ${h}:${m}:${s}`}>
      <span className="pt-count__label">{live ? 'Start time reached' : 'Paper opens in'}</span>
      <div className="pt-count__digits" aria-hidden>
        <span>{h}</span>:<span>{m}</span>:<span>{s}</span>
      </div>
      {!compact && <span className="pt-count__at">{longDate ? utcDateTime(startTime) : `start ${utcTime(startTime)}`}</span>}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
