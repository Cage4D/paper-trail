/**
 * Centre (and marker) groups on the board's client — QoreSeal epoch groups (spec §4.2, §6).
 *
 * One `EpochKeyManager` per group. Every membership change starts a new epoch with a fresh
 * random key, sealed to the current members only: a removed invigilator cannot open
 * anything from later epochs (`NOT_A_RECIPIENT` / `UNKNOWN_EPOCH`).
 * Group keys: "centre:<centreId>" → purpose "papertrail:centre:<centreId>", and
 * "markers:<examId>" → "papertrail:markers:<examId>" (QoreSeal label rule, findings Q7).
 *
 * The board's state (every group's epoch history AND member recipients: `exportKeys()`
 * alone omits members, findings Q7) is sealed to the board, purpose
 * "papertrail:board-state:v1", and stored by the API as an opaque blob.
 */
import { EpochKeyManager, open, openEpochKey, seal, type EpochKey, type SealKeyPair, type SealRecipient } from "@qorechain/qoreseal";
import { PURPOSE } from "./split.js";
import { CHAIN_ID, b64url, checkLabel, fromB64url, fromUtf8, sha3Hex, utf8, wipe } from "./util.js";

export interface Rotation {
  groupKey: string;
  epoch: bigint;
  /** Epoch key sealed to the current members (null when the group is empty). */
  envelope: Uint8Array | null;
  /** SHA3-256 of the sorted, lower-cased member addresses joined by "," (goes on chain). */
  membersHash: `0x${string}`;
  /** SHA3-256 of the envelope (goes on chain); zero hash when there is no envelope. */
  envelopeHash: `0x${string}`;
  members: string[];
}

export const groupPurpose = (groupKey: string) => checkLabel(`papertrail:${groupKey}`);
export const centreGroupKey = (centreId: string) => `centre:${centreId}`;
export const markersGroupKey = (examId: string) => `markers:${examId}`;

/**
 * The bytes32 id PaperTrail.rotateEpoch uses for a group: a centre group uses its centreId;
 * any other group (markers) uses SHA3-256("papertrail:" + groupKey).
 */
export function groupChainId(groupKey: string): `0x${string}` {
  const m = /^centre:(0x[0-9a-fA-F]{64})$/.exec(groupKey);
  return m ? (m[1].toLowerCase() as `0x${string}`) : sha3Hex(utf8(`papertrail:${groupKey}`));
}

export function membersHash(members: string[]): `0x${string}` {
  return sha3Hex(utf8([...members].map((m) => m.toLowerCase()).sort().join(",")));
}

const ZERO = `0x${"00".repeat(32)}` as const;

export class BoardGroups {
  private readonly groups = new Map<string, { mgr: EpochKeyManager; recipients: Map<string, SealRecipient> }>();

  private rotation(groupKey: string, epoch: bigint, envelope: Uint8Array | null): Rotation {
    const g = this.groups.get(groupKey)!;
    const members = [...g.recipients.keys()];
    return { groupKey, epoch, envelope, membersHash: membersHash(members), envelopeHash: envelope ? sha3Hex(envelope) : ZERO, members };
  }

  private need(groupKey: string) {
    const g = this.groups.get(groupKey);
    if (!g) throw new Error(`unknown group ${groupKey}`);
    return g;
  }

  /** New group with its first members: a single epoch (1), not one epoch per member. */
  create(groupKey: string, members: Record<string, SealRecipient>): Rotation {
    if (this.groups.has(groupKey)) throw new Error(`group ${groupKey} exists`);
    const mgr = new EpochKeyManager({ chainId: CHAIN_ID, purpose: groupPurpose(groupKey), members });
    this.groups.set(groupKey, { mgr, recipients: new Map(Object.entries(members)) });
    return this.rotation(groupKey, mgr.epoch, mgr.members().length ? mgr.distribution() : null);
  }

  add(groupKey: string, address: string, recipient: SealRecipient): Rotation {
    const g = this.need(groupKey);
    const r = g.mgr.addMember(address, recipient);
    g.recipients.set(address, recipient);
    return this.rotation(groupKey, r.epoch, r.envelope);
  }

  remove(groupKey: string, address: string): Rotation {
    const g = this.need(groupKey);
    if (!g.recipients.has(address)) throw new Error(`${address} is not in ${groupKey}`);
    const r = g.mgr.removeMember(address);
    g.recipients.delete(address);
    return this.rotation(groupKey, r.epoch, r.envelope);
  }

  rotate(groupKey: string): Rotation {
    const r = this.need(groupKey).mgr.rotate();
    return this.rotation(groupKey, r.epoch, r.envelope);
  }

  epoch(groupKey: string): bigint {
    return this.need(groupKey).mgr.epoch;
  }

  /** The board's current epoch key for a group (board only: it opens every batch of the group). */
  currentKey(groupKey: string): EpochKey {
    return this.need(groupKey).mgr.currentKey;
  }

  members(groupKey: string): string[] {
    return [...this.need(groupKey).recipients.keys()];
  }

  recipients(groupKey: string): SealRecipient[] {
    return [...this.need(groupKey).recipients.values()];
  }

  /** Seal the whole state (histories + member recipients) to the board. */
  exportSealed(board: SealRecipient): Uint8Array {
    const state = {
      v: 1,
      groups: Object.fromEntries(
        [...this.groups].map(([k, g]) => [
          k,
          {
            history: g.mgr.exportKeys().map((e) => ({ epoch: e.epoch.toString(), key: b64url(e.key) })),
            members: Object.fromEntries([...g.recipients].map(([a, r]) => [a, { mlkem: b64url(r.mlkemPublicKey), x25519: r.x25519PublicKey ? b64url(r.x25519PublicKey) : undefined }])),
          },
        ]),
      ),
    };
    const pt = utf8(JSON.stringify(state));
    const env = seal({ chainId: CHAIN_ID, purpose: PURPOSE.boardState, plaintext: pt, recipients: [board] });
    wipe(pt);
    return env;
  }

  static restoreSealed(envelope: Uint8Array, boardKeys: SealKeyPair): BoardGroups {
    const pt = open({ chainId: CHAIN_ID, purpose: PURPOSE.boardState, envelope, keys: boardKeys });
    const state = JSON.parse(fromUtf8(pt)) as {
      v: 1;
      groups: Record<string, { history: { epoch: string; key: string }[]; members: Record<string, { mlkem: string; x25519?: string }> }>;
    };
    wipe(pt);
    const bg = new BoardGroups();
    for (const [k, g] of Object.entries(state.groups)) {
      const members: Record<string, SealRecipient> = Object.fromEntries(
        Object.entries(g.members).map(([a, r]) => [a, { mlkemPublicKey: fromB64url(r.mlkem), ...(r.x25519 ? { x25519PublicKey: fromB64url(r.x25519) } : {}) }]),
      );
      const history = g.history.map((h) => ({ epoch: BigInt(h.epoch), key: fromB64url(h.key) }));
      bg.groups.set(k, { mgr: new EpochKeyManager({ chainId: CHAIN_ID, purpose: groupPurpose(k), history, members }), recipients: new Map(Object.entries(members)) });
    }
    return bg;
  }
}

/** Member side: open a rotation envelope with your sealing keys. Throws NOT_A_MEMBER when you are not a recipient. */
export function openGroupEpoch(args: { groupKey: string; envelope: Uint8Array; keys: SealKeyPair }): EpochKey {
  try {
    return openEpochKey({ chainId: CHAIN_ID, purpose: groupPurpose(args.groupKey), envelope: args.envelope, keys: args.keys });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "NOT_A_RECIPIENT" || code === "DECRYPTION_FAILED") throw Object.assign(new Error("NOT_A_MEMBER"), { code: "NOT_A_MEMBER", cause: e });
    throw e;
  }
}
