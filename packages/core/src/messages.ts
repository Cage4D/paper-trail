/**
 * Messages sealed to QoreChain addresses (the "seal to any address" tool, client side).
 *
 *  - resolveAddressRecipient: an address's registered keys, read from the chain. With a recipient
 *    card the card is verified against the address's ML-DSA-87 key and ML-KEM-1024 key on chain
 *    (hybrid: ML-KEM-1024 + X25519); without one, the registered ML-KEM-1024 key alone ("mlkem").
 *    In a browser, pass `fetch: chainFetchViaEvmRpc(evmRpc)`: QoreChain's REST endpoint sends no
 *    CORS headers, the EVM JSON-RPC serves the same registries.
 *  - sealMessage / openMessage: QoreSeal, purpose "papertrail:message:v1". The envelope is one
 *    mode for everyone: hybrid only if every recipient has a verified card, otherwise "mlkem".
 *    The list of recipient addresses is authenticated (aad), so a file whose "to" list was edited
 *    won't open.
 *  - encodeMessageFile / decodeMessageFile: a small JSON file (.ptseal) to download or paste.
 */
import { open, seal, type SealKeyPair, type SealMode, type SealRecipient } from "@qorechain/qoreseal";
import { resolveRecipient } from "@qorechain/qoreseal/network";
import { parseAddress } from "@qorechain/qoresign";
import type { RecipientCard } from "@qorechain/qoreseal";
import { CHAIN_ID, b64url, fromB64url, fromUtf8, sha3, utf8, wipe } from "./util.js";

export const MESSAGE_PURPOSE = "papertrail:message:v1";
export const MESSAGE_FILE_FORMAT = "paper-trail-sealed-message";
const DEFAULT_REST = "https://api-testnet.qore.host";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class AddressNotSealableError extends Error {
  constructor(
    readonly address: string,
    readonly reason: "invalid-address" | "no-kem-key" | "card-invalid" | "network",
    message: string,
  ) {
    super(message);
  }
}

export interface ResolvedAddress {
  /** qor1… */
  address: string;
  mode: SealMode;
  recipient: SealRecipient;
}

/** Resolve one address to a sealing recipient, from the chain. Throws AddressNotSealableError. */
export async function resolveAddressRecipient(args: { address: string; card?: RecipientCard; rest?: string; fetch?: FetchLike }): Promise<ResolvedAddress> {
  let address: string;
  try {
    address = parseAddress(args.address.trim()).bech32;
  } catch {
    throw new AddressNotSealableError(args.address, "invalid-address", `"${args.address}" isn't a QoreChain address.`);
  }
  const base = { rest: args.rest ?? DEFAULT_REST, chainId: CHAIN_ID, address, ...(args.fetch ? { fetch: args.fetch } : {}) };
  try {
    if (args.card) return { address, mode: "hybrid", recipient: await resolveRecipient({ ...base, card: args.card, mode: "hybrid" }) };
    return { address, mode: "mlkem", recipient: await resolveRecipient({ ...base, mode: "mlkem" }) };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "KEM_KEY_NOT_REGISTERED") throw new AddressNotSealableError(address, "no-kem-key", `${address} has no ML-KEM-1024 key registered on QoreChain, so nothing can be sealed to it yet.`);
    if (code === "CARD_INVALID" || code === "CARD_MISMATCH" || /card/i.test(String(code))) throw new AddressNotSealableError(address, "card-invalid", `${address}'s recipient card doesn't match its keys on QoreChain.`);
    throw new AddressNotSealableError(address, "network", `Couldn't read ${address}'s keys from QoreChain (${code ?? (e as Error).message}).`);
  }
}

const aadFor = (to: string[]) => sha3(utf8(`${MESSAGE_PURPOSE}\n${[...to].sort().join("\n")}`));

export interface MessageFile {
  format: typeof MESSAGE_FILE_FORMAT;
  v: 1;
  chainId: string;
  purpose: string;
  mode: SealMode;
  /** recipients' qor1 addresses (authenticated: editing the list breaks decryption) */
  to: string[];
  /** base64url QoreSeal envelope */
  envelope: string;
}

/** Seal a text message to resolved addresses. */
export function sealMessage(args: { text: string; to: ResolvedAddress[] }): MessageFile {
  if (!args.to.length) throw new Error("add at least one recipient");
  const mode: SealMode = args.to.every((r) => r.mode === "hybrid" && r.recipient.x25519PublicKey) ? "hybrid" : "mlkem";
  const recipients = mode === "hybrid" ? args.to.map((r) => r.recipient) : args.to.map((r) => ({ mlkemPublicKey: r.recipient.mlkemPublicKey }));
  const to = args.to.map((r) => r.address);
  const pt = utf8(args.text);
  const envelope = seal({ chainId: CHAIN_ID, purpose: MESSAGE_PURPOSE, plaintext: pt, aad: aadFor(to), recipients, mode });
  wipe(pt);
  return { format: MESSAGE_FILE_FORMAT, v: 1, chainId: CHAIN_ID, purpose: MESSAGE_PURPOSE, mode, to, envelope: b64url(envelope) };
}

/** Open a sealed message with a recipient's keys. Throws QoreSeal NOT_A_RECIPIENT for other keys. */
export function openMessage(file: MessageFile, keys: SealKeyPair): string {
  if (file.format !== MESSAGE_FILE_FORMAT || file.purpose !== MESSAGE_PURPOSE || file.chainId !== CHAIN_ID) throw new Error("not a Paper Trail sealed message for this chain");
  const pt = open({ chainId: CHAIN_ID, purpose: MESSAGE_PURPOSE, envelope: fromB64url(file.envelope), keys, aad: aadFor(file.to) });
  const text = fromUtf8(pt);
  wipe(pt);
  return text;
}

export const encodeMessageFile = (f: MessageFile): string => JSON.stringify(f, null, 2);

export function decodeMessageFile(text: string): MessageFile {
  let f: MessageFile;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error("that isn't a Paper Trail sealed message (not JSON)");
  }
  if (!f || f.format !== MESSAGE_FILE_FORMAT || f.v !== 1 || !Array.isArray(f.to) || typeof f.envelope !== "string") throw new Error("that isn't a Paper Trail sealed message");
  return f;
}
