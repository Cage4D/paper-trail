/// <reference lib="webworker" />
// Runs @paper-trail/core in a Web Worker for the "Try the encryption" page. The role keys made here
// never leave this worker: messages back to the page carry only public facts (addresses, sizes,
// codes) and the decrypted note the visitor typed. Everything is forgotten when the page closes.
import * as core from '@paper-trail/core';
import { API_URL, CHAIN_ID, CONTRACT, EVM_RPC, QORE_REST } from '../lib/config';
import { errorCode, makeKey, openNote, sealNote, type RoleKey, type Sealed } from '../lib/sealLab';

type Req =
  | { id: number; type: 'make-key' }
  | { id: number; type: 'seal'; text: string; examId: string; centreId: string; markers?: { board: string; groupChainId: string; epoch: number; epochTx: string; members: core.GroupMember[] } }
  | { id: number; type: 'open' }
  | { id: number; type: 'open-with-stranger' }
  | { id: number; type: 'forget' }
  | { id: number; type: 'seal-to'; text: string; addresses: string[]; cards: Record<string, unknown> }
  | { id: number; type: 'my-create'; passphrase: string }
  | { id: number; type: 'my-unlock'; blob: core.EncryptedRoleKey; passphrase: string }
  | { id: number; type: 'my-status' }
  | { id: number; type: 'my-register' }
  | { id: number; type: 'my-open'; fileText: string }
  | { id: number; type: 'my-forget' };

/** The visitor's own key, unlocked with their passphrase. Never posted back to the page. */
let myKey: RoleKey | null = null;
// QoreChain's REST and Tendermint RPC send no CORS headers: registration goes through the API's
// relay, which forwards the browser-signed transactions unchanged.
const RELAY = { rest: `${API_URL}/chain/rest`, rpc: `${API_URL}/chain/rpc` };
const rpcFetch = core.chainFetchViaEvmRpc(EVM_RPC);

async function qorBalance(evm: string): Promise<string> {
  const r = await fetch(EVM_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [evm, 'latest'] }) });
  const wei = BigInt((await r.json()).result ?? '0x0');
  const whole = wei / 10n ** 18n;
  const frac = ((wei % 10n ** 18n) / 10n ** 14n).toString().padStart(4, '0');
  return `${whole}.${frac}`;
}

let mine: RoleKey | null = null;
let sealed: Sealed | null = null;

const reply = (id: number, ok: boolean, body: unknown) => (self as unknown as Worker).postMessage({ id, ok, body });

self.onmessage = async (e: MessageEvent<Req>) => {
  const m = e.data;
  try {
    if (m.type === 'make-key') {
      if (mine) core.wipeRoleKey(mine);
      const { key, info } = makeKey(core);
      mine = key;
      sealed = null;
      return reply(m.id, true, info);
    }
    if (m.type === 'seal') {
      if (!mine) throw new Error('Make a key first.');
      let extra: RoleKey['recipient'][] = [];
      let checks: { what: string; ok: boolean }[] = [];
      if (m.markers) {
        const t = performance.now();
        // check the marker team against QoreChain itself, not the API's word for it
        extra = await core.resolveGroupRecipients({
          evmRpc: EVM_RPC, rest: QORE_REST, contract: CONTRACT, board: m.markers.board, groupChainId: m.markers.groupChainId,
          epoch: m.markers.epoch, epochTx: m.markers.epochTx, members: m.markers.members, fetch: core.kemFetchViaEvmRpc(EVM_RPC),
        });
        checks = [
          { what: 'The marker team list matches the one the exam board signed on QoreChain', ok: true },
          { what: 'That team version is still the current one on QoreChain', ok: true },
          ...m.markers.members.map((_m, i) => ({ what: `Marker ${i + 1}'s card matches their quantum-safe keys registered on QoreChain`, ok: true })),
        ];
        checks.push({ what: `Checked in ${Math.round(performance.now() - t)} ms (chain id ${CHAIN_ID})`, ok: true });
      }
      const r = sealNote(core, { key: mine, text: m.text, examId: m.examId, centreId: m.centreId, extra });
      sealed = r.sealed;
      return reply(m.id, true, { ...r.info, checks });
    }
    if (m.type === 'open') {
      if (!mine || !sealed) throw new Error('Lock a message first.');
      return reply(m.id, true, openNote(core, { key: mine, sealed }));
    }
    if (m.type === 'open-with-stranger') {
      if (!sealed) throw new Error('Lock a message first.');
      const { key: stranger, info } = makeKey(core);
      try {
        openNote(core, { key: stranger, sealed });
        return reply(m.id, true, { opened: true, stranger: info.address });
      } catch (err) {
        return reply(m.id, true, { opened: false, code: errorCode(err), stranger: info.address });
      } finally {
        core.wipeRoleKey(stranger);
      }
    }
    if (m.type === 'seal-to') {
      const results: { address: string; ok: boolean; mode?: string; error?: string; reason?: string }[] = [];
      const resolved: core.ResolvedAddress[] = [];
      for (const a of m.addresses) {
        try {
          // a card, when the directory has one, is verified against the address's keys on chain (hybrid)
          const r = await core.resolveAddressRecipient({ address: a, card: m.cards[a] as never, fetch: rpcFetch });
          resolved.push(r);
          results.push({ address: r.address, ok: true, mode: r.mode });
        } catch (err) {
          const e = err as core.AddressNotSealableError;
          results.push({ address: a, ok: false, error: e.message, reason: e.reason });
        }
      }
      if (results.some((r) => !r.ok)) return reply(m.id, true, { results });
      const file = core.sealMessage({ text: m.text, to: resolved });
      return reply(m.id, true, { results, fileText: core.encodeMessageFile(file), mode: file.mode, bytes: core.fromB64url(file.envelope).length });
    }
    if (m.type === 'my-create') {
      if (myKey) core.wipeRoleKey(myKey);
      myKey = core.createRoleKey();
      const blob = core.encryptRoleKey(myKey, m.passphrase); // Argon2id + AES-256-GCM; only this leaves the worker
      return reply(m.id, true, { blob, address: myKey.address, evm: myKey.evm });
    }
    if (m.type === 'my-unlock') {
      try {
        if (myKey) core.wipeRoleKey(myKey);
        myKey = core.decryptRoleKey(m.blob, m.passphrase);
      } catch {
        myKey = null;
        throw Object.assign(new Error("That passphrase doesn't unlock this key."), { code: 'BAD_PASSPHRASE' });
      }
      return reply(m.id, true, { address: myKey.address, evm: myKey.evm });
    }
    if (m.type === 'my-status') {
      if (!myKey) throw new Error('Unlock your key first.');
      const [status, balance] = await Promise.all([core.roleStatus(myKey, { rest: RELAY.rest }), qorBalance(myKey.evm)]);
      return reply(m.id, true, { ...status, balance });
    }
    if (m.type === 'my-register') {
      if (!myKey) throw new Error('Unlock your key first.');
      const r = await core.ensureRoleOnChain(myKey, { rest: RELAY.rest, rpc: RELAY.rpc });
      return reply(m.id, true, { pqcTx: r.pqcTx ?? null, kemTx: r.kemTx ?? null, status: r.status, balance: await qorBalance(myKey.evm) });
    }
    if (m.type === 'my-open') {
      if (!myKey) throw new Error('Unlock your key first.');
      const file = core.decodeMessageFile(m.fileText);
      try {
        return reply(m.id, true, { opened: true, text: core.openMessage(file, myKey.seal), to: file.to, mode: file.mode, mine: file.to.includes(myKey.address) });
      } catch (err) {
        return reply(m.id, true, { opened: false, code: errorCode(err), to: file.to, mode: file.mode, mine: file.to.includes(myKey.address) });
      }
    }
    if (m.type === 'my-forget') {
      if (myKey) core.wipeRoleKey(myKey);
      myKey = null;
      return reply(m.id, true, null);
    }
    if (m.type === 'forget') {
      if (myKey) core.wipeRoleKey(myKey);
      myKey = null;
      if (mine) core.wipeRoleKey(mine);
      mine = null;
      sealed = null;
      return reply(m.id, true, null);
    }
  } catch (err) {
    reply(m.id, false, { code: errorCode(err), message: err instanceof Error ? err.message : String(err) });
  }
};
