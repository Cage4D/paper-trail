// Environment for the web app. Values come from VITE_* env vars (see .env.example);
// the defaults are the live qorechain-diana testnet deployment.
const env = import.meta.env;
const trim = (s: string) => s.replace(/\/+$/, '');

export const API_URL = trim(env.VITE_API_URL ?? 'https://paper-trail-api.vercel.app');
export const EVM_RPC = trim(env.VITE_EVM_RPC ?? 'https://evm-testnet.qore.host');
export const QORE_REST = trim(env.VITE_QORE_REST ?? 'https://api-testnet.qore.host');
export const QORE_RPC = trim(env.VITE_QORE_RPC ?? 'https://rpc-testnet.qore.host');
export const EXPLORER = trim(env.VITE_EXPLORER ?? 'https://explore.qore.network');
export const CONTRACT = (env.VITE_CONTRACT ?? '0xbe6b208Bc8990a68740053Dad68624914812cf8F') as `0x${string}`;
export const CHAIN_ID = 9800;
export const CHAIN_NAME = 'qorechain-diana';
export const REPO_URL = 'https://github.com/Cage4D/paper-trail';
export const BADGE_URL = 'https://build.qorechain.io/badge/paper-trail.svg';
export const PROJECT_URL = 'https://build.qorechain.io/p/paper-trail';

export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER}/address/${addr}`;
