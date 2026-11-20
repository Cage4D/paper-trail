/**
 * Paper Trail role keys (spec §3.2).
 *
 * One BIP-39 mnemonic derives, all through the official kits:
 *  - the classical key: `deriveClassicalKey({ type: "eth_secp256k1" })`, m/44'/60'/0'/0/0
 *    (QoreChain unified account: one key, qor1… and 0x… forms);
 *  - the canonical ML-DSA-87 key: `deriveCanonicalPqKey`, which the chain registers;
 *  - the QoreSeal keys (ML-KEM-1024 + X25519): `deriveSealKeys`, index 0.
 * Same derivation as @qorechain/sdk `deriveUnifiedAccount` (checked in findings Q4).
 *
 * Stored in the browser encrypted with a passphrase: Argon2id (@noble/hashes) → AES-256-GCM
 * (@noble/ciphers). Only the mnemonic is stored; everything else is re-derived.
 */
import { addressFromPublicKey, deriveCanonicalPqKey, deriveClassicalKey, type ClassicalKey, type PqKeyPair } from "@qorechain/qoresign";
import { deriveSealKeys, recipientOf, type SealKeyPair, type SealRecipient } from "@qorechain/qoreseal";
import { argon2id } from "@noble/hashes/argon2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { b64url, fromUtf8, randomBytes, utf8, wipe } from "./util.js";

export interface RoleKey {
  mnemonic: string;
  /** qor1… */
  address: string;
  /** 0x… EIP-55 */
  evm: `0x${string}`;
  classical: ClassicalKey;
  pq: PqKeyPair;
  seal: SealKeyPair;
  recipient: SealRecipient;
}

export function roleKeyFromMnemonic(mnemonic: string): RoleKey {
  const m = mnemonic.trim().split(/\s+/).join(" ");
  if (!validateMnemonic(m, wordlist)) throw new Error("invalid BIP-39 mnemonic");
  const classical = deriveClassicalKey({ mnemonic: m, type: "eth_secp256k1", index: 0 });
  const addr = addressFromPublicKey(classical.publicKey, "eth_secp256k1");
  const pq = deriveCanonicalPqKey({ mnemonic: m, address: addr.bech32 });
  const seal = deriveSealKeys({ mnemonic: m, index: 0 });
  return { mnemonic: m, address: addr.bech32, evm: addr.hex as `0x${string}`, classical, pq, seal, recipient: recipientOf(seal) };
}

/** A new role key from a fresh 24-word mnemonic. */
export function createRoleKey(): RoleKey {
  return roleKeyFromMnemonic(generateMnemonic(wordlist, 256));
}

/** Overwrite the role key's secret bytes (the mnemonic string itself cannot be wiped in JS). */
export function wipeRoleKey(k: RoleKey): void {
  wipe(k.classical.privateKey, k.pq.secretKey, k.seal.seed, k.seal.mlkemSecretKey, k.seal.x25519SecretKey);
}

/** Argon2id cost. Default = OWASP's minimum recommendation (19 MiB, 2 passes). */
export interface KdfParams {
  m: number;
  t: number;
  p: number;
}
export const DEFAULT_KDF: KdfParams = { m: 19456, t: 2, p: 1 };

export interface EncryptedRoleKey {
  v: 1;
  kdf: "argon2id";
  params: KdfParams;
  salt: string; // base64url
  nonce: string; // base64url, 12 bytes
  ciphertext: string; // base64url, AES-256-GCM(mnemonic)
  address: string; // public, for display before unlocking
}

function fromB64url(s: string): Uint8Array {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const c of s) {
    const v = A.indexOf(c);
    if (v < 0) throw new Error("invalid base64url");
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

const AAD = utf8("papertrail:role-key:v1");

export function encryptRoleKey(k: RoleKey, passphrase: string, params: KdfParams = DEFAULT_KDF): EncryptedRoleKey {
  if (passphrase.length < 8) throw new Error("passphrase must be at least 8 characters");
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = argon2id(utf8(passphrase), salt, { ...params, dkLen: 32 });
  const pt = utf8(k.mnemonic);
  const ct = gcm(key, nonce, AAD).encrypt(pt);
  wipe(key, pt);
  return { v: 1, kdf: "argon2id", params, salt: b64url(salt), nonce: b64url(nonce), ciphertext: b64url(ct), address: k.address };
}

/** Throws "wrong passphrase or corrupted key" when authentication fails. */
export function decryptRoleKey(blob: EncryptedRoleKey, passphrase: string): RoleKey {
  if (blob.v !== 1 || blob.kdf !== "argon2id") throw new Error("unsupported role key format");
  const key = argon2id(utf8(passphrase), fromB64url(blob.salt), { ...blob.params, dkLen: 32 });
  let pt: Uint8Array;
  try {
    pt = gcm(key, fromB64url(blob.nonce), AAD).decrypt(fromB64url(blob.ciphertext));
  } catch {
    throw new Error("wrong passphrase or corrupted key");
  } finally {
    wipe(key);
  }
  const k = roleKeyFromMnemonic(fromUtf8(pt));
  wipe(pt);
  if (k.address !== blob.address) throw new Error("decrypted key does not match the stored address");
  return k;
}
