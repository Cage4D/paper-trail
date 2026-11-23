// Optional "Connect QoreX": reads the user's own qor1 address from the QoreX wallet and shows it.
// Read-only (enable + getKey); judge mode never asks the wallet to sign anything.
import { useState } from 'react';
import { getQorexNative, isQorexInstalled } from '@qorechain/qorex-types';
import { IconWallet } from '@tabler/icons-react';
import { CHAIN_NAME } from '../lib/config';
import { HashLink } from './HashLink';

export function QorexConnect() {
  const [address, setAddress] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    if (busy) return;
    const native = isQorexInstalled() ? getQorexNative() : null;
    if (!native) return setNote('QoreX isn’t installed in this browser. The demo works without it.');
    setBusy(true);
    setNote(null);
    try {
      await native.enable(CHAIN_NAME);
      setAddress((await native.getKey(CHAIN_NAME)).bech32Address);
    } catch {
      setNote('QoreX didn’t share an address. The demo works without it.');
    } finally {
      setBusy(false);
    }
  };
  if (address)
    return (
      <span className="pt-row" style={{ gap: 8 }}>
        <span className="pt-hash__label">your QoreX address</span>
        <HashLink value={address} kind="address" small />
      </span>
    );
  return (
    <span className="pt-row" style={{ gap: 8 }}>
      <button type="button" className="pt-btn pt-btn--sm" onClick={connect} aria-busy={busy || undefined}>
        <IconWallet size={16} stroke={2} aria-hidden />
        {busy ? 'Connecting…' : 'Connect QoreX'}
      </button>
      {note && <span className="pt-small pt-muted">{note}</span>}
    </span>
  );
}
