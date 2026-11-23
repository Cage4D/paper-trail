import { useEffect, useId, useRef, useState } from 'react';
import { useHealth } from '../lib/hooks';

/** QoreChain / API status from GET /health. Mint = live, amber = warnings, coral = unreachable. */
export function HealthChip({ long = false }: { long?: boolean }) {
  const h = useHealth();
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

  let tone: 'ok' | 'warn' | 'down' | 'loading' = 'loading';
  let text = long ? 'QoreChain testnet: checking…' : 'Checking…';
  const details: string[] = [];
  if (h.status === 'down') {
    tone = 'down';
    text = long ? "QoreChain testnet: can't reach the API" : 'API unreachable';
    details.push("The Paper Trail API didn't answer. Actions will fail until it's back.");
  } else if (h.status === 'ok') {
    const { health } = h;
    const bal = health.relayerBalanceQor.ok && health.relayerBalanceQor.value ? Number(health.relayerBalanceQor.value).toFixed(1) : null;
    tone = health.ok && !health.warnings.length ? 'ok' : 'warn';
    text = long ? `QoreChain testnet: ${tone === 'ok' ? 'live' : 'degraded'}${bal ? ` · relayer ${bal} QOR` : ''}` : tone === 'ok' ? 'Testnet live' : 'Testnet degraded';
    details.push(...health.warnings);
    if (health.rpc.ok && health.rpc.value) details.push(`Latest block ${Number(health.rpc.value).toLocaleString('en-GB')}`);
    if (bal) details.push(`Relayer balance ${bal} QOR`);
    if (health.indexerLagBlocks.ok && health.indexerLagBlocks.value) details.push(`Indexer ${health.indexerLagBlocks.value} blocks behind`);
    for (const [k, c] of Object.entries({ database: health.db, 'EVM RPC': health.rpc })) if (!c.ok) details.push(`${k}: unavailable`);
  }
  return (
    <span className="pt-healthwrap" ref={ref}>
      <button type="button" className={`pt-health pt-health--${tone}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="pt-health__dot" aria-hidden />
        {text}
      </button>
      {open && (
        <div id={id} className="pt-popover" role="status">
          <strong>{tone === 'ok' ? 'Everything is running' : tone === 'warn' ? 'Running with warnings' : tone === 'down' ? 'API unreachable' : 'Checking'}</strong>
          <ul>
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <span className="pt-muted pt-small">qorechain-diana · chain id 9800</span>
        </div>
      )}
    </span>
  );
}
