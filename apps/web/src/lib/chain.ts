// Direct, read-only chain access (viem) for checks that shouldn't take the API's word for it.
import { createPublicClient, defineChain, http, type Hex } from 'viem';
import { PAPERTRAIL_ABI } from '@paper-trail/shared';
import { CHAIN_ID, CONTRACT, EVM_RPC, EXPLORER } from './config';

export const qorechainDiana = defineChain({
  id: CHAIN_ID,
  name: 'QoreChain testnet (diana)',
  nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 },
  rpcUrls: { default: { http: [EVM_RPC] } },
  blockExplorers: { default: { name: 'QoreChain explorer', url: EXPLORER } },
  testnet: true,
});

let client: ReturnType<typeof createPublicClient> | null = null;
const getClient = () => (client ??= createPublicClient({ chain: qorechainDiana, transport: http(EVM_RPC, { timeout: 20_000, retryCount: 2 }) }));

/** PaperTrail.commitment(examId, centreId), read straight from the contract. */
export async function readCommitment(examId: Hex, centreId: Hex): Promise<Hex> {
  return (await getClient().readContract({ address: CONTRACT, abi: PAPERTRAIL_ABI, functionName: 'commitment', args: [examId, centreId] })) as Hex;
}
