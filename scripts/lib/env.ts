// Shared helpers for scripts/: load the repo-root .env and derive role accounts.
// Secrets (mnemonics, private keys, PQC secret keys) are never printed.
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { deriveUnifiedAccount, type UnifiedAccount } from "@qorechain/sdk";

export const ROOT_ENV = fileURLToPath(new URL("../../.env", import.meta.url));
config({ path: ROOT_ENV, quiet: true });

/** Demo roles from spec §8 (candidate bots have no role keys). Order = funding priority after the relayer. */
export const DEMO_ROLES = [
  "board",
  "examiner1",
  "examiner2",
  "examiner3",
  "invigilatorA1",
  "invigilatorA2",
  "invigilatorB1",
  "marker1",
  "marker2",
] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];
export type Role = "relayer" | DemoRole;

export function demoMnemonics(): Partial<Record<DemoRole, string>> {
  const raw = process.env.DEMO_MNEMONICS?.trim();
  return raw ? JSON.parse(raw) : {};
}

export function mnemonicFor(role: Role): string {
  const m = role === "relayer" ? process.env.RELAYER_MNEMONIC?.trim() : demoMnemonics()[role];
  if (!m) throw new Error(`No mnemonic for ${role} in .env; run \`pnpm accounts\` first`);
  return m;
}

/**
 * QoreChain unified account (@qorechain/sdk): secp256k1 at m/44'/60'/0'/0/0 (one key,
 * qor1… and 0x… encodings of the same 20 bytes) plus the canonical ML-DSA-87 key
 * SHAKE256("qorechain:pqc:v1|" + qor1addr + "|" + mnemonic). Same derivation as the
 * template's scripts/window.ts with QORE_MNEMONIC.
 */
export async function accountFor(role: Role): Promise<UnifiedAccount> {
  return deriveUnifiedAccount(mnemonicFor(role), 0);
}

export const ALL_ROLES: Role[] = ["relayer", ...DEMO_ROLES];

/** Set or replace KEY=value lines in the root .env (mode 600). */
export function writeEnv(updates: Record<string, string>): void {
  let text = existsSync(ROOT_ENV) ? readFileSync(ROOT_ENV, "utf8") : "";
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : text + (text.endsWith("\n") || !text ? "" : "\n") + line + "\n";
  }
  writeFileSync(ROOT_ENV, text, { mode: 0o600 });
  chmodSync(ROOT_ENV, 0o600);
}
export { appendFileSync };
