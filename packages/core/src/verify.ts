/**
 * Client-side group verification (bug-hunt finding 3). Before sealing a share or a script, a client
 * must not trust the API's member list. resolveGroupRecipients rebuilds the recipients from the
 * CHAIN:
 *   1. the EpochChanged log of that epoch, fetched by its tx hash from the EVM RPC (not the API),
 *      must come from PaperTrail and name this board, group and epoch;
 *   2. the epoch must still be current on chain (centreEpoch);
 *   3. the member addresses must hash to the membersHash the board signed in that event;
 *   4. every member's signed recipient card must verify against the PQC key (pqcKeyStatus
 *      precompile) and the ML-KEM key (QoreSeal KEM registry) registered on chain for that member.
 * A compromised API cannot add itself as a recipient: it can neither forge the board-signed
 * membersHash nor a card that verifies against someone's on-chain keys.
 */
import { createPublicClient, decodeEventLog, getAddress, http, parseAbi, type Hex } from "viem";
import { parseAddress } from "@qorechain/qoresign";
import { verifyRecipientCard, type RecipientCard, type SealRecipient } from "@qorechain/qoreseal";
import { fetchMlkemPublicKey } from "@qorechain/qoreseal/network";
import { membersHash } from "./groups.js";
import { CHAIN_ID, fromHex } from "./util.js";

const ABI = parseAbi([
  "event EpochChanged(address indexed board, bytes32 indexed centreId, uint64 epoch, bytes32 membersHash, bytes32 envelopeHash)",
  "function centreEpoch(address board, bytes32 groupId) view returns (uint64)",
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey)",
]);
const PQC_STATUS = "0x0000000000000000000000000000000000000a02";

export interface GroupMember {
  address: string; // 0x
  roleAddress: string; // qor1
  card: RecipientCard;
}

export class GroupVerificationError extends Error {
  readonly code = "GROUP_NOT_VERIFIED";
}

export async function resolveGroupRecipients(args: {
  evmRpc: string;
  rest: string;
  contract: string;
  board: string;
  groupChainId: string;
  epoch: number;
  /** tx hash of the EpochChanged event for `epoch` (the API gives it; the chain proves it) */
  epochTx: string;
  members: GroupMember[];
}): Promise<SealRecipient[]> {
  const fail = (why: string): never => {
    throw new GroupVerificationError(`group not verified: ${why}`);
  };
  const client = createPublicClient({ transport: http(args.evmRpc) });
  const contract = getAddress(args.contract);
  const board = getAddress(args.board);
  const gid = args.groupChainId.toLowerCase();

  // 1. the board-signed membersHash for this epoch, read from the chain
  const receipt = await client.getTransactionReceipt({ hash: args.epochTx as Hex }).catch(() => null);
  if (!receipt || receipt.status !== "success") fail("epoch transaction not found on chain");
  let signedHash: string | undefined;
  for (const l of receipt!.logs) {
    if (l.address.toLowerCase() !== contract.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: ABI, data: l.data, topics: l.topics });
      if (ev.eventName !== "EpochChanged") continue;
      const a = ev.args as { board: string; centreId: string; epoch: bigint; membersHash: string };
      if (a.board.toLowerCase() === board.toLowerCase() && a.centreId.toLowerCase() === gid && Number(a.epoch) === args.epoch) signedHash = a.membersHash.toLowerCase();
    } catch {
      /* other events */
    }
  }
  if (!signedHash) fail("no matching EpochChanged event in that transaction");
  // 2. still the current epoch
  const current = Number(await client.readContract({ address: contract, abi: ABI, functionName: "centreEpoch", args: [board, gid as Hex] }));
  if (current !== args.epoch) fail(`epoch ${args.epoch} is no longer current (chain is at ${current})`);
  // 3. the list is the signed list
  if (membersHash(args.members.map((m) => m.address)) !== signedHash) fail("member list does not match the board-signed membersHash");
  // 4. every card verifies against that member's on-chain keys
  return Promise.all(
    args.members.map(async (m) => {
      if (parseAddress(m.roleAddress).hex.toLowerCase() !== m.address.toLowerCase()) fail(`address mismatch for ${m.roleAddress}`);
      const [registered, algorithmId, pubkey] = (await client.readContract({ address: PQC_STATUS, abi: ABI, functionName: "pqcKeyStatus", args: [getAddress(m.address)] })) as readonly [boolean, number, Hex];
      if (!registered || algorithmId !== 1) fail(`${m.roleAddress} has no registered ML-DSA-87 key`);
      const mlkemPublicKey = await fetchMlkemPublicKey({ rest: args.rest, address: m.roleAddress });
      try {
        return verifyRecipientCard({ card: m.card, chainId: CHAIN_ID, address: m.roleAddress, pqPublicKey: fromHex(pubkey), mlkemPublicKey });
      } catch {
        return fail(`recipient card of ${m.roleAddress} does not verify against its on-chain keys`);
      }
    }),
  );
}
