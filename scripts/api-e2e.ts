/**
 * pnpm api:e2e — Phase 4 exit check, live on qorechain-diana through the running API.
 *
 *   board signs in (SIWQ, role key) → registers its recipient card → sets an exam with
 *   @paper-trail/core (committee bundle, 2 centres, shares) → POST /exams and POST
 *   /exams/:id/centres ×2 with board ML-DSA-87 signatures → the API verifies, relays, and its
 *   indexer stores ExamCreated + CentreSet ×2. The relayer's window is checked before and
 *   after: if it had expired, the API must have reopened it by itself.
 *
 * Needs the API running (default http://localhost:3000). Uses the demo board/examiner keys
 * from .env; prints only public data. Writes scripts/out/api-e2e.json.
 */
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createPublicClient, getAddress, http, type Hex } from "viem";
import { evmWindowStatus } from "@qorechain/evm";
import { PAPERTRAIL_ABI } from "../packages/shared/src/abi.js";
import {
  Action, b64url, buildAction, examIdFor, recipientCardFor, roleKeyFromMnemonic, setExam, signAction, signSignIn, toHex,
} from "../packages/core/src/index.js";
import { mnemonicFor } from "./lib/env.js";
import { EVM_RPC, EXPLORER, REST, bigintJson } from "./lib/chain.js";

const API = process.env.API_URL ?? "http://localhost:3000";
const CONTRACT = getAddress(process.env.PAPERTRAIL_ADDRESS!);
const client = createPublicClient({ transport: http(EVM_RPC) });
const board = roleKeyFromMnemonic(mnemonicFor("board"));
const ex = (["examiner1", "examiner2", "examiner3"] as const).map((r) => roleKeyFromMnemonic(mnemonicFor(r)));
const relayer = roleKeyFromMnemonic(mnemonicFor("relayer"));
const out: Record<string, unknown> = { api: API, contract: CONTRACT };

async function api(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}
const window = async () => bigintJson(await evmWindowStatus({ rest: REST, address: relayer.address }));

// 0. window before
out.windowBefore = await window();
console.log("window before:", JSON.stringify(out.windowBefore));

// 1. SIWQ with the board's role key
const { message } = await api("POST", "/auth/siwq/challenge", { address: board.address });
const { token, user } = await api("POST", "/auth/siwq/verify", { message, signature: signSignIn(board, message) });
console.log("signed in as", user.roleAddress);

// 2. recipient card (checked by the API against the keys on chain)
out.card = await api("POST", "/me/role", { sealCard: recipientCardFor(board) }, token);
out.status = await api("GET", "/me/role/status", undefined, token);

// 3. set the exam locally
const salt = toHex(randomBytes(32)) as Hex;
const examId = examIdFor(board.evm, salt);
const centreIds = [toHex(randomBytes(32)), toHex(randomBytes(32))] as Hex[];
const paper = (await import("node:fs")).readFileSync(new URL("../packages/core/fixtures/sample-paper.md", import.meta.url), "utf8");
const part = (k: typeof board) => ({ address: k.evm, recipient: k.recipient });
const setup = await setExam({ paperMarkdown: paper, examId, examiners: [part(ex[0]), part(ex[1]), part(ex[2])], board: part(board), centreIds });
const latest = await client.getBlock();
const startTime = Number(latest.timestamp) + 24 * 3600;
let nonce = (await client.readContract({ address: CONTRACT, abi: PAPERTRAIL_ABI, functionName: "nonces", args: [board.evm] })) as bigint;
const sign = (action: Action, fields: never) => toHex(signAction(board.pq.secretKey, buildAction(action, fields, { chainId: 9800, contract: CONTRACT, signer: board.evm, nonce: nonce++ }).digest));

// 4. POST /exams
const examiners = ex.map((k) => k.evm) as [Hex, Hex, Hex];
const createFields = { salt, board: board.evm, examiners, startTime: BigInt(startTime), masterCommitment: setup.masterCommitment, committeeBundleHash: setup.committeeBundleHash };
const created = await api("POST", "/exams", {
  title: "Phase 4 API e2e", salt, startTime, examiners, masterCommitment: setup.masterCommitment,
  committeeBlob: b64url(setup.committeeEnvelope), signature: sign(Action.CreateExam, createFields as never),
}, token);
console.log("createExam", created.txHash, "windowReopened:", created.windowReopened);
const steps: unknown[] = [{ step: "createExam", tx: created.txHash, explorer: `${EXPLORER}/tx/${created.txHash}`, windowReopened: created.windowReopened }];

// 5. POST /exams/:id/centres ×2
for (const [i, c] of setup.centres.entries()) {
  const r = await api("POST", `/exams/${examId}/centres`, {
    name: `Centre ${"AB"[i]}`, centreId: c.centreId, commitment: c.commitment, cipherBlob: b64url(c.cipher),
    shares: c.shares.map((s) => b64url(s)), signature: sign(Action.SetCentre, { examId, centreId: c.centreId, commitment: c.commitment, cipherHash: c.cipherHash } as never),
  }, token);
  console.log(`setCentre ${"AB"[i]}`, r.txHash);
  steps.push({ step: `setCentre ${"AB"[i]}`, tx: r.txHash, explorer: `${EXPLORER}/tx/${r.txHash}`, windowReopened: r.windowReopened });
}
out.steps = steps;

// 6. the indexer has stored the events (GET /exams/:id catches up first)
let view;
for (let i = 0; i < 20; i++) {
  view = await api("GET", `/exams/${examId}`);
  if (view.status === "CREATED" && view.centres.every((c: { confirmed: boolean }) => c.confirmed)) break;
  await new Promise((r) => setTimeout(r, 3000));
}
out.view = view;
out.windowAfter = await window();
out.health = await api("GET", "/health");
console.log("exam status:", view.status, "centres confirmed:", view.centres.map((c: { confirmed: boolean }) => c.confirmed));
console.log("window after:", JSON.stringify(out.windowAfter));
if (view.status !== "CREATED" || !view.centres.every((c: { confirmed: boolean }) => c.confirmed)) throw new Error("indexer did not record the events");
writeFileSync(new URL("./out/api-e2e.json", import.meta.url), JSON.stringify(bigintJson(out), null, 2) + "\n");
console.log("api e2e passed");
