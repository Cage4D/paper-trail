/// <reference lib="webworker" />
// Runs @paper-trail/core in a Web Worker for the "Try the encryption" page. The role keys made here
// never leave this worker: messages back to the page carry only public facts (addresses, sizes,
// codes) and the decrypted note the visitor typed. Everything is forgotten when the page closes.
import * as core from '@paper-trail/core';
import { CHAIN_ID, CONTRACT, EVM_RPC, QORE_REST } from '../lib/config';
import { errorCode, makeKey, openNote, sealNote, type RoleKey, type Sealed } from '../lib/sealLab';

type Req =
  | { id: number; type: 'make-key' }
  | { id: number; type: 'seal'; text: string; examId: string; centreId: string; markers?: { board: string; groupChainId: string; epoch: number; epochTx: string; members: core.GroupMember[] } }
  | { id: number; type: 'open' }
  | { id: number; type: 'open-with-stranger' }
  | { id: number; type: 'forget' };

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
    if (m.type === 'forget') {
      if (mine) core.wipeRoleKey(mine);
      mine = null;
      sealed = null;
      return reply(m.id, true, null);
    }
  } catch (err) {
    reply(m.id, false, { code: errorCode(err), message: err instanceof Error ? err.message : String(err) });
  }
};
