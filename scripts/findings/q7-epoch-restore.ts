/**
 * Finding Q7 — QoreSeal EpochKeyManager restore across process restarts.
 *
 * Offline (no chain). Throwaway random keys, nothing from .env.
 *   phase "write":   new manager, 3 members, remove one, seal a batch per epoch,
 *                    persist { history: exportKeys(), members (public recipients) } to a file.
 *   phase "read":    a NEW process restores with `new EpochKeyManager({ history, members })`,
 *                    then checks epoch, keys, opening old batches, rotating to a new epoch,
 *                    and that the removed member is still locked out.
 * Run: pnpm findings:q7   (spawns both phases)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EpochKeyManager, openBatch, openEpochKey, recipientOf, sealBatch, sealKeysFromSeed,
  type EpochKey, type SealKeyPair, type SealRecipient,
} from "@qorechain/qoreseal";

const STATE = fileURLToPath(new URL("./out/q7-state.json", import.meta.url));
const CHAIN = "qorechain-diana";
const PURPOSE = "papertrail:centre:demo-A";
const CONTEXT = "exam-1:centre-A"; // QoreSeal context charset: [A-Za-z0-9._:/-]{1,128}
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const ub64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
// Deterministic member key seeds so the second process can re-derive secret keys (test only).
const seedOf = (name: string) => new Uint8Array(32).fill(name.charCodeAt(name.length - 1));
const keys = (name: string): SealKeyPair => sealKeysFromSeed(seedOf(name));
const recip = (r: SealRecipient) => ({ mlkemPublicKey: b64(r.mlkemPublicKey), x25519PublicKey: r.x25519PublicKey ? b64(r.x25519PublicKey) : undefined });
const unrecip = (r: { mlkemPublicKey: string; x25519PublicKey?: string }): SealRecipient =>
  ({ mlkemPublicKey: ub64(r.mlkemPublicKey), ...(r.x25519PublicKey ? { x25519PublicKey: ub64(r.x25519PublicKey) } : {}) }) as SealRecipient;
const canOpen = (envelope: Uint8Array | null, who: string) => {
  if (!envelope) return "no-envelope";
  try { return `epoch ${openEpochKey({ chainId: CHAIN, purpose: PURPOSE, envelope, keys: keys(who) }).epoch}`; }
  catch (e) { return `refused (${(e as { code?: string }).code ?? (e as Error).message})`; }
};

const phase = process.argv[2];
if (phase === "write") {
  const m = new EpochKeyManager({ chainId: CHAIN, purpose: PURPOSE });
  for (const n of ["inv1", "inv2", "inv3"]) m.addMember(n, recipientOf(keys(n)));
  const b1 = sealBatch({ epochKey: m.currentKey, context: CONTEXT, batchIndex: 0, data: new TextEncoder().encode("before removal") });
  const rot = m.removeMember("inv2");
  const b2 = sealBatch({ epochKey: m.currentKey, context: CONTEXT, batchIndex: 1, data: new TextEncoder().encode("after removal") });
  const members = Object.fromEntries(m.members().map((n) => [n, recip(recipientOf(keys(n)))]));
  writeFileSync(STATE, JSON.stringify({
    epoch: m.epoch.toString(),
    history: m.exportKeys().map((k: EpochKey) => ({ epoch: k.epoch.toString(), key: b64(k.key) })),
    members,
    batches: [b64(b1.blob), b64(b2.blob)],
    removalEnvelope: rot.envelope ? b64(rot.envelope) : null,
  }));
  console.log(JSON.stringify({ phase, epoch: m.epoch.toString(), members: m.members(), inv2OnRemovalEnvelope: canOpen(rot.envelope, "inv2") }));
} else if (phase === "read") {
  const s = JSON.parse(readFileSync(STATE, "utf8"));
  const history: EpochKey[] = s.history.map((h: { epoch: string; key: string }) => ({ epoch: BigInt(h.epoch), key: ub64(h.key) }));
  const members = Object.fromEntries(Object.entries(s.members).map(([n, r]) => [n, unrecip(r as never)]));
  const m = new EpochKeyManager({ chainId: CHAIN, purpose: PURPOSE, history, members });
  const res: Record<string, unknown> = { phase, restoredEpoch: m.epoch.toString(), savedEpoch: s.epoch, members: m.members() };
  res.keysMatch = history.every((h) => Buffer.from(m.keyFor(h.epoch) ?? []).equals(Buffer.from(h.key)));
  res.openOldBatches = s.batches.map((b: string) => new TextDecoder().decode(openBatch({ blob: ub64(b), keys: m }).data));
  const rot = m.rotate();
  res.afterRotateEpoch = rot.epoch.toString();
  res.inv1OnNewEnvelope = canOpen(rot.envelope, "inv1");
  res.inv3OnNewEnvelope = canOpen(rot.envelope, "inv3");
  res.removedInv2OnNewEnvelope = canOpen(rot.envelope, "inv2");
  console.log(JSON.stringify(res));
} else {
  const self = fileURLToPath(import.meta.url);
  const outs: string[] = [];
  for (const p of ["write", "read"]) {
    const r = spawnSync(process.execPath, ["--import", "tsx", self, p], { encoding: "utf8" });
    if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
    outs.push(r.stdout.trim());
  }
  console.log(outs.join("\n"));
  writeFileSync(STATE.replace("q7-state.json", "q7.txt"), outs.join("\n") + "\n");
}
