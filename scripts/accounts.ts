/**
 * pnpm accounts — create the relayer + demo role accounts (spec §3.4, §8).
 *
 * Generates any missing BIP-39 mnemonics locally (generateMnemonic, 24 words)
 * and stores them ONLY in the repo-root .env (RELAYER_MNEMONIC, DEMO_MNEMONICS).
 * Existing mnemonics are never replaced. Prints only public addresses.
 *
 * It also cross-checks the two official derivations the spec relies on (Q4):
 * @qorechain/sdk deriveUnifiedAccount vs @qorechain/qoresign deriveClassicalKey
 * (eth_secp256k1) + deriveCanonicalPqKey. They must give the same address and
 * the same ML-DSA-87 public key, or the role keys of §3.2 would not match the
 * keys the chain has registered.
 */
import { generateMnemonic } from "@qorechain/sdk";
import { addressFromPublicKey, deriveCanonicalPqKey, deriveClassicalKey } from "@qorechain/qoresign";
import { ALL_ROLES, DEMO_ROLES, accountFor, demoMnemonics, mnemonicFor, writeEnv } from "./lib/env.js";

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const updates: Record<string, string> = {};
if (!process.env.RELAYER_MNEMONIC?.trim()) {
  updates.RELAYER_MNEMONIC = `"${generateMnemonic(256)}"`;
}
const demo = demoMnemonics();
let demoChanged = false;
for (const role of DEMO_ROLES) {
  if (!demo[role]) {
    demo[role] = generateMnemonic(256);
    demoChanged = true;
  }
}
if (demoChanged) updates.DEMO_MNEMONICS = `'${JSON.stringify(demo)}'`;
if (Object.keys(updates).length) {
  writeEnv(updates);
  // reload what we just wrote
  if (updates.RELAYER_MNEMONIC) process.env.RELAYER_MNEMONIC = updates.RELAYER_MNEMONIC.slice(1, -1);
  if (updates.DEMO_MNEMONICS) process.env.DEMO_MNEMONICS = JSON.stringify(demo);
  console.log(`Wrote ${Object.keys(updates).join(", ")} to .env (values not shown).\n`);
} else {
  console.log("All mnemonics already present in .env; nothing generated.\n");
}

const rows: string[] = [];
let allMatch = true;
for (const role of ALL_ROLES) {
  const acct = await accountFor(role);
  const mnemonic = mnemonicFor(role);
  const classical = deriveClassicalKey({ mnemonic, type: "eth_secp256k1", index: 0 });
  const addr = addressFromPublicKey(classical.publicKey, "eth_secp256k1");
  const pq = deriveCanonicalPqKey({ mnemonic, address: acct.cosmos });
  const match =
    addr.bech32 === acct.cosmos &&
    addr.hex.toLowerCase() === acct.evm.toLowerCase() &&
    eq(pq.publicKey, acct.pqc.publicKey);
  allMatch &&= match;
  rows.push(`| ${role.padEnd(13)} | ${acct.cosmos} | ${acct.evm} | ${match ? "yes" : "NO"} |`);
}
console.log("| role          | native (faucet)                            | EVM                                        | sdk = qoresign |");
console.log("|---------------|--------------------------------------------|--------------------------------------------|----------------|");
for (const r of rows) console.log(r);
if (!allMatch) {
  console.error("\nDerivation mismatch between @qorechain/sdk and @qorechain/qoresign. Stop and investigate.");
  process.exit(1);
}
