/**
 * pnpm full:e2e — Phase 5 exit check: a full exam across 2 centres, live on qorechain-diana,
 * through the running API (default http://localhost:3000). Every action is signed by the
 * role keys with ML-DSA-87 and checked on chain; the relayer only submits.
 *
 *   sign-in + cards (11 roles) → set exam (2 centres) → groups (A: A1,A2 · B: B1 · markers)
 *   → early release refused (TOO_EARLY) → start time → A: release ×1 → NOT_RELEASED → board
 *   removes A2 (epoch 2) → A: second release → Released; B: 2 releases → Released
 *   → A1 and B1 open authentic copies; A2 cannot → 5 scripts sealed to markers → board batch
 *   submit → blind marking → published Merkle root + proof → leak excerpt traced to centre B
 *   → QoreX binding (examiner2's native account stands in for the board operator's QoreX
 *   wallet) → audit timeline.
 *
 * Needs the demo roles registered (pnpm register <role>) and the API running. Prints only
 * public data; writes scripts/out/full-e2e.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { StargateClient } from "@cosmjs/stargate";
import { EthNativeSigner, deriveUnifiedAccount, getNetwork } from "@qorechain/sdk";
import { createPublicClient, getAddress, http, type Hex } from "viem";
import { PAPERTRAIL_ABI } from "../packages/shared/src/abi.js";
import {
  Action, BoardGroups, b64url, bindingStatement, buildAction, buildMarksTree, centreGroupKey, examIdFor, fromB64url, groupChainId,
  markersGroupKey, matchLeak, newPseudonym, openCommitteeBundle, openPaper, openScript, prepareRelease, recipientCardFor,
  roleKeyFromMnemonic, sealScript, setExam, signAction, signSignIn, statementHash, toHex, verifyMarkProof, type RoleKey,
} from "../packages/core/src/index.js";
import { mnemonicFor, type Role } from "./lib/env.js";
import { EVM_RPC, EXPLORER, REST, RPC, bigintJson } from "./lib/chain.js";

const API = process.env.API_URL ?? "http://localhost:3000";
const CONTRACT = getAddress(process.env.PAPERTRAIL_ADDRESS!);
const client = createPublicClient({ transport: http(EVM_RPC) });
const R = (r: Role) => roleKeyFromMnemonic(mnemonicFor(r));
const k = {
  board: R("board"), ex: [R("examiner1"), R("examiner2"), R("examiner3")],
  A1: R("invigilatorA1"), A2: R("invigilatorA2"), B1: R("invigilatorB1"), m: [R("marker1"), R("marker2")],
};
const everyone: RoleKey[] = [k.board, ...k.ex, k.A1, k.A2, k.B1, ...k.m];
const tokens = new Map<RoleKey, string>();
const log: { step: string; tx?: string; explorer?: string; note?: string }[] = [];
const step = (s: string, tx?: string, note?: string) => {
  log.push({ step: s, ...(tx ? { tx, explorer: tx.startsWith("0x") ? `${EXPLORER}/tx/${tx}` : undefined } : {}), ...(note ? { note } : {}) });
  console.log(`✔ ${s}${tx ? `  ${tx}` : ""}${note ? `  (${note})` : ""}`);
};

async function api(method: string, path: string, who?: RoleKey, body?: unknown, expect?: number) {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${tokens.get(who)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  if (expect !== undefined ? r.status !== expect : !r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}
const nonceOf = async (who: RoleKey) => (await client.readContract({ address: CONTRACT, abi: PAPERTRAIL_ABI, functionName: "nonces", args: [who.evm] })) as bigint;
async function sign(who: RoleKey, action: Action, fields: never, nonce?: bigint) {
  const n = nonce ?? (await nonceOf(who));
  return toHex(signAction(who.pq.secretKey, buildAction(action, fields, { chainId: 9800, contract: CONTRACT, signer: who.evm, nonce: n }).digest));
}
const recipients = (members: { mlkemPublicKey: string; x25519PublicKey: string }[]) =>
  members.map((m) => ({ mlkemPublicKey: fromB64url(m.mlkemPublicKey), x25519PublicKey: Uint8Array.from(Buffer.from(m.x25519PublicKey, "hex")) }));

// ── 1. sign-in + recipient cards ──
for (const who of everyone) {
  const { message } = await api("POST", "/auth/siwq/challenge", undefined, { address: who.address });
  tokens.set(who, (await api("POST", "/auth/siwq/verify", undefined, { message, signature: signSignIn(who, message) })).token);
  await api("POST", "/me/role", who, { sealCard: recipientCardFor(who) });
}
step(`11 role keys signed in (SIWQ) and published recipient cards`);

// ── 2. set the exam ──
const salt = toHex(randomBytes(32)) as Hex;
const examId = examIdFor(k.board.evm, salt).toLowerCase() as Hex;
const A = toHex(randomBytes(32)) as Hex;
const B = toHex(randomBytes(32)) as Hex;
const paper = readFileSync(new URL("../packages/core/fixtures/sample-paper.md", import.meta.url), "utf8");
const part = (x: RoleKey) => ({ address: x.evm, recipient: x.recipient });
const setup = await setExam({ paperMarkdown: paper, examId, examiners: [part(k.ex[0]), part(k.ex[1]), part(k.ex[2])], board: part(k.board), centreIds: [A, B] });
const examiners = k.ex.map((x) => x.evm) as [Hex, Hex, Hex];
const startTime = Number((await client.getBlock()).timestamp) + 240;
const cf = { salt, board: k.board.evm, examiners, startTime: BigInt(startTime), masterCommitment: setup.masterCommitment, committeeBundleHash: setup.committeeBundleHash };
const created = await api("POST", "/exams", k.board, { title: "Phase 5 full e2e", salt, startTime, examiners, masterCommitment: setup.masterCommitment, committeeBlob: b64url(setup.committeeEnvelope), signature: await sign(k.board, Action.CreateExam, cf as never) });
step("createExam", created.txHash, created.windowReopened ? `window reopened ${created.windowReopened}` : undefined);
for (const c of setup.centres) {
  const r = await api("POST", `/exams/${examId}/centres`, k.board, { name: c.centreId === A ? "Centre A" : "Centre B", centreId: c.centreId, commitment: c.commitment, cipherBlob: b64url(c.cipher), shares: c.shares.map((s) => b64url(s)), signature: await sign(k.board, Action.SetCentre, { examId, centreId: c.centreId, commitment: c.commitment, cipherHash: c.cipherHash } as never) });
  step(`setCentre ${c.centreId === A ? "A" : "B"}`, r.txHash);
}

// ── 3. groups ──
const groups = new BoardGroups();
async function addGroup(groupKey: string, members: RoleKey[], role: "invigilator" | "marker") {
  const r = groups.create(groupKey, Object.fromEntries(members.map((m) => [m.evm, m.recipient])));
  const signature = await sign(k.board, Action.RotateEpoch, { centreId: groupChainId(groupKey), board: k.board.evm, epoch: r.epoch, membersHash: r.membersHash, envelopeHash: r.envelopeHash } as never);
  const res = await api("POST", `/groups/${groupKey}/members`, k.board, { addresses: members.map((m) => m.evm), role, envelope: b64url(r.envelope!), epoch: Number(r.epoch), membersHash: r.membersHash, signature, sealedBoardState: b64url(groups.exportSealed(k.board.recipient)) });
  step(`rotateEpoch ${groupKey.split(":")[0]} ${groupKey === centreGroupKey(A) ? "A" : groupKey === centreGroupKey(B) ? "B" : ""} → 1 (${members.length} members)`, res.txHash);
}
await addGroup(centreGroupKey(A), [k.A1, k.A2], "invigilator");
await addGroup(centreGroupKey(B), [k.B1], "invigilator");
await addGroup(markersGroupKey(examId), k.m, "marker");

// ── 4. releases ──
async function release(i: number, centreId: Hex, expect?: number) {
  const share = await api("GET", `/exams/${examId}/centres/${centreId}/my-share`, k.ex[i]);
  const inv = await api("GET", `/exams/${examId}/centres/${centreId}/invigilators`);
  const r = prepareRelease({ shareEnvelope: fromB64url(share.sealedToExaminer), examinerKeys: k.ex[i].seal, examinerIndex: share.examinerIndex, examId, centreId, epoch: inv.epoch, invigilators: recipients(inv.members) });
  const signature = await sign(k.ex[i], Action.Release, { examId, centreId, blobHash: r.blobHash, examiner: k.ex[i].evm } as never);
  return api("POST", `/exams/${examId}/centres/${centreId}/release`, k.ex[i], { releasedBlob: b64url(r.blob), blobHash: r.blobHash, epoch: inv.epoch, signature }, expect);
}
const early = await release(0, A, 409);
step("early release refused by the contract", undefined, `${early.error.code}: ${early.error.message}`);
process.stdout.write(`… waiting for start time (${new Date(startTime * 1000).toISOString()})\n`);
while (Number((await client.getBlock()).timestamp) < startTime) await new Promise((r) => setTimeout(r, 4000));

step("release A by examiner1 (epoch 1: A1, A2)", (await release(0, A)).txHash);
const nr = await api("GET", `/exams/${examId}/centres/${A}/released`, undefined, undefined, 409);
step("released blobs withheld before Released", undefined, nr.error.message);
const rem = groups.remove(centreGroupKey(A), k.A2.evm);
const remSig = await sign(k.board, Action.RotateEpoch, { centreId: A, board: k.board.evm, epoch: rem.epoch, membersHash: rem.membersHash, envelopeHash: rem.envelopeHash } as never);
step("board removes invigilator A2 → epoch 2", (await api("DELETE", `/groups/${centreGroupKey(A)}/members/${k.A2.evm}`, k.board, { envelope: b64url(rem.envelope!), epoch: 2, membersHash: rem.membersHash, signature: remSig, sealedBoardState: b64url(groups.exportSealed(k.board.recipient)) })).txHash);
const rA = await release(2, A);
step(`release A by examiner3 (epoch 2: A1) → released=${rA.released}`, rA.txHash);
step("release B by examiner1", (await release(0, B)).txHash);
const rB = await release(1, B);
step(`release B by examiner2 → released=${rB.released}`, rB.txHash);

// ── 5. invigilators open ──
async function open(centreId: Hex, who: RoleKey) {
  const rel = await api("GET", `/exams/${examId}/centres/${centreId}/released`);
  return openPaper({ released: rel.released.map((x: { blob: string; epoch: number }) => ({ blob: fromB64url(x.blob), epoch: x.epoch })), invigilatorKeys: who.seal, examId, centreId, cipher: fromB64url(rel.cipherBlob), commitment: rel.commitment });
}
step(`A1 opens centre A: authentic=${(await open(A, k.A1)).authentic}`);
const openedB = await open(B, k.B1);
step(`B1 opens centre B: authentic=${openedB.authentic}`);
let a2 = "opened (WRONG)";
await open(A, k.A2).catch((e: Error) => (a2 = e.message));
if (a2 !== "NOT_A_MEMBER") throw new Error(`removed invigilator: ${a2}`);
step("removed invigilator A2 cannot open centre A", undefined, a2);

// ── 6. scripts → blind marking → published root ──
const mk = await api("GET", `/exams/${examId}/markers`);
const pseudonyms: string[] = [];
for (const [centreId, n] of [[A, 3], [B, 2]] as const)
  for (let i = 0; i < n; i++) {
    const ps = newPseudonym();
    pseudonyms.push(ps);
    const s = sealScript({ examId, centreId, pseudonym: ps, answers: { q1: i, centre: centreId === A ? "A" : "B" }, markers: recipients(mk.members) });
    await api("POST", `/exams/${examId}/scripts`, undefined, { centreId, pseudonymHash: s.pseudonymHash, blob: b64url(s.envelope), scriptHash: s.scriptHash, markerEpoch: mk.epoch });
  }
const pending = await api("GET", `/exams/${examId}/scripts/pending`, k.board);
let n = await nonceOf(k.board);
const items = [];
for (const p of pending) items.push({ scriptId: p.scriptId, signature: await sign(k.board, Action.SubmitScript, { examId, centreId: p.centreId, pseudonymHash: p.pseudonymHash, scriptHash: p.scriptHash, markerEpoch: BigInt(p.markerEpoch) } as never, n++) });
const sub = await api("POST", `/exams/${examId}/scripts/submit`, k.board, { items });
sub.submitted.forEach((x: { txHash: string }, i: number) => step(`submitScript ${i + 1}/${sub.submitted.length}`, x.txHash));
const queue = await api("GET", `/exams/${examId}/scripts`, k.m[0]);
for (const q of queue) {
  const body = openScript({ envelope: fromB64url(q.blob), keys: k.m[0].seal, examId, centreId: q.centreId, pseudonymHash: q.pseudonymHash });
  await api("POST", `/scripts/${q.scriptId}/marks`, k.m[0], { score: 60 + (body.answers as { q1: number }).q1 * 5 });
}
step(`marker1 marked ${queue.length} scripts (pseudonyms only)`);
const { entries } = await api("GET", `/exams/${examId}/marks`, k.board);
const tree = buildMarksTree(entries);
step("publishMarks", (await api("POST", `/exams/${examId}/marks/publish`, k.board, { merkleRoot: tree.root, signature: await sign(k.board, Action.PublishMarks, { examId, merkleRoot: tree.root } as never) })).txHash, tree.root);
const proof = await api("GET", `/exams/${examId}/marks/proof?pseudonym=${pseudonyms[4]}`);
const onchainRoot = proof.merkleRoot;
step(`candidate proof verifies: ${verifyMarkProof(onchainRoot, { pseudonymHash: proof.pseudonymHash, score: proof.score }, proof.proof)} (score ${proof.score})`);

// ── 7. leak: an excerpt of centre B's paper names centre B ──
const committee = openCommitteeBundle({ envelope: setup.committeeEnvelope, keys: k.ex[1].seal, examId });
const excerpt = openedB.text.split(/\n(?=Q\d+:)/).filter((b) => /^Q\d+:/.test(b)).slice(4, 7).join("\n").toUpperCase();
const leak = matchLeak(excerpt, committee.paper, committee.tables);
step(`leak traced: ${leak.copy === B ? "centre B" : leak.copy} (confidence ${leak.confidence.toFixed(2)}, ${leak.matchedBits}/${leak.observedBits} bits)`);
if (leak.copy !== B) throw new Error("leak detection failed");

// ── 8. QoreX binding (examiner2's native account stands in for the operator's QoreX wallet) ──
const ch = await api("POST", "/me/bind/challenge", k.board);
const qx = await deriveUnifiedAccount(mnemonicFor("examiner2"), 0);
const acc = (await (await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${qx.cosmos}`)).json()) as { account: Record<string, unknown> };
const base = (acc.account.base_account ?? acc.account) as Record<string, string>;
const transport = await StargateClient.connect(RPC);
const self = await new EthNativeSigner(qx, { signMode: "hybrid", rest: REST }).bankSend(transport, qx.cosmos, [{ denom: "uqor", amount: "1" }], {
  chainId: getNetwork("testnet").chainId, accountNumber: BigInt(base.account_number), sequence: BigInt(base.sequence), memo: ch.memo,
  fee: { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" },
});
transport.disconnect();
step("QoreX stand-in self-transfer with the binding memo (native, hybrid-signed)", self.transactionHash);
await new Promise((r) => setTimeout(r, 4000));
const st = statementHash(bindingStatement({ roleAddress: k.board.address, qorexAddress: qx.cosmos, nonce: ch.nonce, txHash: self.transactionHash }));
const bound = await api("POST", "/me/bind", k.board, { qorexAddress: qx.cosmos, txHash: self.transactionHash, signature: await sign(k.board, Action.BindIdentity, { role: k.board.evm, statementHash: st } as never) });
step("bindIdentity (board role key ↔ QoreX address)", bound.relayTx);

// ── 9. audit ──
const audit = await api("GET", `/exams/${examId}/audit`);
const counts = audit.timeline.reduce((m: Record<string, number>, e: { name: string }) => ((m[e.name] = (m[e.name] ?? 0) + 1), m), {});
step("audit timeline", undefined, JSON.stringify(counts));
writeFileSync(new URL("./out/full-e2e.json", import.meta.url), JSON.stringify(bigintJson({ api: API, contract: CONTRACT, examId, centres: { A, B }, startTime, steps: log, auditCounts: counts, leak: { copy: leak.copy, confidence: leak.confidence, matchedBits: leak.matchedBits, observedBits: leak.observedBits } }), null, 2) + "\n");
console.log("full e2e passed");
