import { IconCheck, IconCopy } from '@tabler/icons-react';
import { Link } from 'react-router';
import { explorerAddress, explorerTx } from '../lib/config';
import { shortHash } from '../lib/format';
import { useCopy } from '../lib/hooks';

type Props = {
  value: string;
  /** tx / address link to the explorer; `plain` is a hash with nothing to open (commitments). */
  kind?: 'tx' | 'address' | 'plain';
  /** Internal route instead of the explorer (e.g. the exam page). */
  to?: string;
  label?: string;
  copy?: boolean;
  small?: boolean;
  network?: string;
};

/** Every address, tx and hash: mono, shortened, full value on hover, explorer link, copy button. */
export function HashLink({ value, kind = 'tx', to, label, copy = true, small, network }: Props) {
  const [copied, doCopy] = useCopy();
  const short = shortHash(value);
  const what = label ?? (kind === 'address' ? 'address' : kind === 'tx' ? 'transaction' : 'hash');
  let inner;
  if (to) inner = <Link to={to} title={value}>{short}</Link>;
  else if (kind === 'plain') inner = <span className="pt-hash__plain" title={value}>{short}</span>;
  else
    inner = (
      <a href={kind === 'tx' ? explorerTx(value) : explorerAddress(value)} target="_blank" rel="noreferrer" title={`${value} (opens the explorer)`}>
        {short}
      </a>
    );
  return (
    <span className={`pt-hash${small ? ' pt-hash--sm' : ''}`}>
      {label && <span className="pt-hash__label">{label}</span>}
      {inner}
      {network && <span className="pt-hash__net">{network}</span>}
      {copy && (
        <button type="button" className="pt-hash__copy" aria-label={copied ? 'Copied' : `Copy ${what}`} title={copied ? 'Copied' : `Copy ${what}`} onClick={() => doCopy(value)}>
          {copied ? <IconCheck size={14} stroke={2} aria-hidden /> : <IconCopy size={14} stroke={2} aria-hidden />}
        </button>
      )}
    </span>
  );
}

/** Several tx links after one label ("rotateEpoch ×3 0x…, 0x…, 0x…"). */
export function TxGroup({ label, txs }: { label: string; txs: string[] }) {
  return (
    <span className="pt-hash">
      <span className="pt-hash__label">{label}</span>
      {txs.map((t) => (
        <a key={t} href={explorerTx(t)} target="_blank" rel="noreferrer" title={`${t} (opens the explorer)`}>
          {shortHash(t)}
        </a>
      ))}
    </span>
  );
}
