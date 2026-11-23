// Display helpers: shortened hashes, UTC times and durations (design handoff §10).

/** `0x1234…abcd` (first 6 incl. 0x, last 4); `qor1abcd…wxyz` for bech32 addresses. */
export function shortHash(v: string): string {
  if (!v) return '';
  if (v.startsWith('qor1')) return v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v;
  return v.length > 12 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "14:52:30 UTC" */
export function utcTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

/** "14:52:30" (UTC, for chips that already say what they are) */
export function utcClock(iso: string | Date): string {
  return utcTime(iso).replace(' UTC', '');
}

/** "23 Nov 2026, 14:52:30 UTC" */
export function utcDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}, ${utcTime(d)}`;
}

/** Seconds → [hh, mm, ss] strings for the countdown keycaps. */
export function hmsParts(totalSeconds: number): [string, string, string] {
  const s = Math.max(0, Math.floor(totalSeconds));
  return [pad(Math.floor(s / 3600)), pad(Math.floor((s % 3600) / 60)), pad(s % 60)];
}

/** "01:12" */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** Replace ISO timestamps in catalog messages (e.g. TOO_EARLY's {startTime}) with "14:52:30 UTC". */
export function humaniseIsoTimes(message: string): string {
  return message.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (m) => utcTime(m));
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
