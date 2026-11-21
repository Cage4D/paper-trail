/**
 * pnpm demo:e2e — Phase 6 exit check: judge mode run headless against the running API (live on
 * qorechain-diana). POST /demo/start, then every scripted beat via /demo/:id/act and
 * /demo/:id/leak, exactly as the frontend's buttons would. Must finish in under 3 minutes.
 * Writes scripts/out/demo-e2e.json. Prints only public data.
 */
import { writeFileSync } from "node:fs";

const API = process.env.API_URL ?? "http://localhost:3000";
const LIMIT_S = 180;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1);
const beats: { beat: number; what: string; at: string; result: string; txs?: string[] }[] = [];
const note = (beat: number, what: string, result: string, txs?: string[]) => {
  beats.push({ beat, what, at: `${el()}s`, result, ...(txs?.length ? { txs } : {}) });
  console.log(`[${el().padStart(6)}s] beat ${beat} · ${what}: ${result}`);
};
async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}
const act = (id: string, as: string, action: string, params?: Record<string, string>) => call("POST", `/demo/${id}/act`, { as, action, params });

const s = await call("POST", "/demo/start");
note(1, "set", `exam ${s.examId.slice(0, 10)}…, 2 centres, groups; canary copies differ in ≥ ${s.variants.minPairDistanceBits} bits (${s.variants.differences.togglesDiffer}/${s.variants.differences.toggles} toggles differ between A and B)`, s.txs.map((t: { tx: string }) => t.tx));

const early = await act(s.demoId, "examiner1", "release");
if (early.beat !== 2 || early.error?.code !== "TOO_EARLY") throw new Error(`early release not refused: ${JSON.stringify(early)}`);
note(2, "early release", `refused by the contract — ${early.error.message}`);

for (;;) {
  const v = await call("GET", `/demo/${s.demoId}`);
  if (v.startsInSeconds <= 0) break;
  await new Promise((r) => setTimeout(r, Math.min(5000, v.startsInSeconds * 1000 + 1500)));
}
let r1;
for (let i = 0; ; i++) {
  r1 = await act(s.demoId, "examiner1", "release");
  if (r1.ok || i > 6) break; // chain time can trail the wall clock by a block or two
  await new Promise((r) => setTimeout(r, 3000));
}
if (!r1.ok) throw new Error(`examiner1 release failed: ${JSON.stringify(r1)}`);
note(3, "examiner 1 (bot) releases centre A", `${r1.count} of 2`, [r1.txHash]);
const r2 = await act(s.demoId, "examiner2", "release");
if (!r2.released) throw new Error(`not released: ${JSON.stringify(r2)}`);
note(3, "judge releases as examiner 2", "2 of 2 → Released", [r2.txHash]);

const o = await act(s.demoId, "invigilatorA1", "open");
if (!o.authentic) throw new Error("A1 could not open an authentic copy");
note(4, "invigilator A1 opens centre A", "Authentic ✓ (SHA3 matches the on-chain commitment)");

const rm = await act(s.demoId, "board", "remove-invigilator", { target: "invigilatorA2" });
note(5, "board removes invigilator A2", `epoch ${rm.epoch}`, [rm.txHash]);
const sc = await act(s.demoId, "candidates", "submit-scripts");
note(5, "6 candidate bots submit scripts", `${sc.submitted.length} recorded on chain, sealed to the markers`, sc.submitted.map((x: { txHash: string }) => x.txHash));
const a2 = await act(s.demoId, "invigilatorA2", "open");
const refused = (a2.laterDocuments ?? []).filter((d: { result: string }) => d.result !== "opened");
if (refused.length !== (a2.laterDocuments ?? []).length || !refused.length) throw new Error(`A2 not locked out: ${JSON.stringify(a2.laterDocuments)}`);
note(5, "removed invigilator A2", refused.map((d: { what: string; result: string }) => `${d.what} → ${d.result}`).join("; "));

const lk = await call("POST", `/demo/${s.demoId}/leak`, { centre: "B" });
if (lk.result.copy !== "Centre B") throw new Error(`leak not traced: ${JSON.stringify(lk.result)}`);
note(6, "leak (noisy centre-B excerpt)", `→ ${lk.result.copy} (confidence ${lk.result.confidence.toFixed(2)}, ${lk.result.matchedBits}/${lk.result.observedBits} bits), epoch ${lk.centre.epoch}, ${lk.centre.recipients.length} recipient(s)`);

const v = await call("GET", `/demo/${s.demoId}`);
const audit = await call("GET", v.audit);
const counts = audit.timeline.reduce((m: Record<string, number>, e: { name: string }) => ((m[e.name] = (m[e.name] ?? 0) + 1), m), {});
note(7, "audit", JSON.stringify(counts));

const total = (Date.now() - t0) / 1000;
writeFileSync(new URL("./out/demo-e2e.json", import.meta.url), JSON.stringify({ api: API, demoId: s.demoId, examId: s.examId, centres: s.centres, totalSeconds: total, beats, auditCounts: counts }, null, 2) + "\n");
console.log(`judge mode completed headless in ${total.toFixed(1)} s (limit ${LIMIT_S} s)`);
if (total >= LIMIT_S) throw new Error(`too slow: ${total.toFixed(1)} s`);
console.log("demo e2e passed");
