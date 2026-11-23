// The QoreChain React kit's PqcStatusBadge, styled as a status chip. Loaded lazily (it brings the
// QoreChain SDK) and only where a native qor1 address is known.
//
// Browser note: the native REST endpoint (api-testnet.qore.host) sends no CORS headers, so the
// badge's default REST lookup fails in a browser. The EVM JSON-RPC endpoint allows CORS and its
// qor_getPQCKeyStatus answers in the same { found, account } shape, so we inject a client whose
// rest.getPqcAccount goes through it. Everything else is the stock SDK client.
import { useMemo } from 'react';
import { PqcStatusBadge, QoreChainProvider } from '@qorechain/react';
import { createClient } from '@qorechain/sdk';
import { IconLoader2, IconRosetteDiscountCheck, IconX } from '@tabler/icons-react';
import { EVM_RPC, QORE_REST, QORE_RPC } from '../lib/config';

async function pqcAccountOverRpc(address: string) {
  const res = await fetch(EVM_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'qor_getPQCKeyStatus', params: [address] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? 'qor_getPQCKeyStatus failed');
  return body.result;
}

const config = { network: 'testnet' as const, endpoints: { rpc: QORE_RPC, rest: QORE_REST, evmRpc: EVM_RPC } };

function useBrowserClient() {
  return useMemo(() => {
    const client = createClient(config);
    const rest = new Proxy(client.rest, { get: (t, p, r) => (p === 'getPqcAccount' ? pqcAccountOverRpc : Reflect.get(t, p, r)) });
    return new Proxy(client, { get: (t, p, r) => (p === 'rest' ? rest : Reflect.get(t, p, r)) });
  }, []);
}

export default function PqcBadge({ address, who }: { address: string; who: string }) {
  const client = useBrowserClient();
  return (
    <QoreChainProvider config={config} client={client}>
      <PqcStatusBadge address={address}>
        {({ isRegistered, isLoading, error }) =>
          isLoading ? (
            <span className="pt-chip pt-chip--sealed">
              <IconLoader2 size={15} stroke={2} className="pt-spin" aria-hidden />
              Checking {who}'s signing key…
            </span>
          ) : error ? null : isRegistered ? (
            <span className="pt-chip pt-chip--authentic" title={`${address}: ML-DSA-87 key registered on QoreChain`}>
              <IconRosetteDiscountCheck size={15} stroke={2} aria-hidden />
              {who}'s quantum-safe key is registered
            </span>
          ) : (
            <span className="pt-chip pt-chip--failed" title={address}>
              <IconX size={15} stroke={2} aria-hidden />
              {who} has no quantum-safe key
            </span>
          )
        }
      </PqcStatusBadge>
    </QoreChainProvider>
  );
}
