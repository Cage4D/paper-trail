/**
 * Test double of ChainService: emulates just enough of PaperTrail (per-signer nonces, epoch
 * groups, release counting) and emits REAL encoded logs, so the indexer, projections and
 * Released gating run as in production. Crypto stays real: pqcVerify checks ML-DSA-87
 * signatures with QoreSign; keys come from real role keys. Test-only (excluded from the build).
 */
import { ContractFunctionRevertedError, decodeFunctionData, encodeAbiParameters, encodeErrorResult, encodeEventTopics, fromHex as vFromHex, getAddress, keccak256, toHex as vToHex, type Hex } from 'viem';
import { pqVerify } from '@qorechain/qoresign';
import { fromHex, toHex, type RoleKey } from '@paper-trail/core';
import { PAPERTRAIL_ABI } from '@paper-trail/shared';

type AbiEvent = { type: 'event'; name: string; inputs: readonly { name: string; type: string; indexed?: boolean }[] };

export class FakeChain {
  address: Hex;
  abi = PAPERTRAIL_ABI;
  rest = 'http://fake';
  explorer = 'https://explore.qore.network';
  registered = new Map<string, RoleKey>();
  nonces = new Map<string, bigint>();
  epochs = new Map<string, number>(); // `${board}|${groupId}`
  releases = new Map<string, number>(); // `${exam}|${centre}`
  needsReopen = false;
  opened = 0;
  sent: { functionName: string; args: unknown[] }[] = [];
  nextRevert?: { errorName: string; args: unknown[] };
  nativeTxs = new Map<string, { code: number; memo: string; messages: Record<string, unknown>[] }>();
  /** fault knobs (bug-hunt finding 2) */
  receiptTimeouts = 0; // the next N waitForTransactionReceipt calls time out (the tx still lands)
  failBroadcastAfterAccept = 0; // the next N broadcasts are applied, then throw a transport error
  broadcasts = new Map<string, number>(); // tx hash → times its raw bytes reached the fake node
  mined = new Set<string>();
  headOffset = 0n; // raise the reported head without new blocks (indexer backfill tests)
  private logs: Record<string, unknown>[] = [];
  private block = 20_000_000n; // above PAPERTRAIL_DEPLOY_BLOCK, where the indexer starts
  private evmNonce = 0;

  constructor(address: string) {
    this.address = getAddress(address);
  }

  register(k: RoleKey) {
    this.registered.set(k.evm.toLowerCase(), k);
  }

  private log(eventName: string, args: Record<string, unknown>, txHash: Hex) {
    const ev = (PAPERTRAIL_ABI as readonly { type: string; name?: string }[]).find((x) => x.type === 'event' && x.name === eventName) as unknown as AbiEvent;
    const topics = encodeEventTopics({ abi: PAPERTRAIL_ABI, eventName: eventName as never, args: args as never });
    const nonIndexed = ev.inputs.filter((i) => !i.indexed);
    const data = encodeAbiParameters(nonIndexed as never, nonIndexed.map((i) => args[i.name]) as never);
    this.logs.push({ address: this.address, topics, data, transactionHash: txHash, blockNumber: this.block, logIndex: this.logs.length });
  }

  client = {
    getBalance: async () => 10n ** 18n,
    getBlockNumber: async () => this.block + this.headOffset,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => this.logs.filter((l) => (l.blockNumber as bigint) >= fromBlock && (l.blockNumber as bigint) <= toBlock),
    readContract: async () => 0n,
    simulateContract: async (p: { functionName: string; args: unknown[] }) => {
      if (this.nextRevert) {
        const r = this.nextRevert;
        this.nextRevert = undefined;
        throw new ContractFunctionRevertedError({ abi: PAPERTRAIL_ABI as never, functionName: p.functionName, data: encodeErrorResult({ abi: PAPERTRAIL_ABI, errorName: r.errorName as never, args: r.args as never }) });
      }
      return { request: p, result: undefined };
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      if (this.receiptTimeouts > 0) {
        this.receiptTimeouts--;
        throw new Error('Timed out while waiting for transaction receipt');
      }
      return this.receipt(hash);
    },
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const r = this.receipt(hash);
      if (!r) throw new Error('receipt not found');
      return r;
    },
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      const hash = keccak256(serializedTransaction);
      this.broadcasts.set(hash, (this.broadcasts.get(hash) ?? 0) + 1);
      if (this.mined.has(hash)) throw new Error('already known');
      const tx = JSON.parse(vFromHex(serializedTransaction, 'string')) as { data: Hex };
      const { functionName, args } = decodeFunctionData({ abi: PAPERTRAIL_ABI, data: tx.data });
      this.apply({ functionName, args: args as unknown as unknown[] }, hash);
      this.mined.add(hash);
      if (this.failBroadcastAfterAccept > 0) {
        this.failBroadcastAfterAccept--;
        throw new Error('socket hang up');
      }
      return hash;
    },
  };

  private receipt(hash: Hex) {
    if (!this.mined.has(hash)) return undefined as never;
    return { status: 'success', blockNumber: this.block, gasUsed: 250_000n, logs: this.logs.filter((l) => l.transactionHash === hash) } as never;
  }

  async relayer() {
    return { cosmos: 'qor1fake', evm: '0x0000000000000000000000000000000000000001' };
  }

  async wallet() {
    return {
      account: { address: '0x0000000000000000000000000000000000000001' },
      chain: undefined,
      prepareTransactionRequest: async (req: { to: Hex; data: Hex }) => ({ to: req.to, data: req.data, nonce: this.evmNonce++ }),
      signTransaction: async (p: { to: Hex; data: Hex; nonce: number }) => vToHex(JSON.stringify({ to: p.to, data: p.data, nonce: p.nonce })),
    };
  }

  /** Apply a contract call's effects (nonces, epochs, releases) and emit its logs. */
  private apply(req: { functionName: string; args: unknown[] }, hash: Hex) {
        this.sent.push(req);
        this.block += 1n;
        const a = req.args as Hex[];
        const signerOf: Record<string, Hex> = { createExam: a[1], release: a[3], bindIdentity: a[0], rotateEpoch: a[1] };
        const signer = (signerOf[req.functionName] ?? this.boardFor(a[0]))!.toLowerCase();
        this.nonces.set(signer, (this.nonces.get(signer) ?? 0n) + 1n);
        switch (req.functionName) {
          case 'createExam':
            this.boards.set(this.examIdOf(a[1], a[0]), a[1].toLowerCase());
            this.log('ExamCreated', { examId: this.examIdOf(a[1], a[0]), board: a[1], examiners: a[2], startTime: a[3], masterCommitment: a[4] }, hash);
            break;
          case 'setCentre':
            this.log('CentreSet', { examId: a[0], centreId: a[1], commitment: a[2], cipherHash: a[3] }, hash);
            break;
          case 'rotateEpoch':
            this.epochs.set(`${a[1].toLowerCase()}|${a[0].toLowerCase()}`, Number(a[2]));
            this.log('EpochChanged', { board: a[1], centreId: a[0], epoch: a[2], membersHash: a[3], envelopeHash: a[4] }, hash);
            break;
          case 'release': {
            const k = `${a[0]}|${a[1]}`.toLowerCase();
            const n = (this.releases.get(k) ?? 0) + 1;
            this.releases.set(k, n);
            const epoch = BigInt(this.epochs.get(`${this.boards.get(a[0].toLowerCase())}|${a[1].toLowerCase()}`) ?? 0);
            this.log('ShareReleased', { examId: a[0], centreId: a[1], examiner: a[3], epoch, blobHash: a[2] }, hash);
            if (n === 2) this.log('Released', { examId: a[0], centreId: a[1], epoch }, hash);
            break;
          }
          case 'submitScript':
            this.log('ScriptSubmitted', { examId: a[0], centreId: a[1], pseudonymHash: a[2], scriptHash: a[3], markerEpoch: a[4] }, hash);
            break;
          case 'publishMarks':
            this.log('MarksPublished', { examId: a[0], merkleRoot: a[1] }, hash);
            break;
          case 'bindIdentity':
            this.log('IdentityBound', { role: a[0], statementHash: a[1] }, hash);
            break;
        }
  }

  boards = new Map<string, string>(); // examId → board
  private examIdOf(board: Hex, salt: Hex): Hex {
    // keccak256(abi.encode(board, salt)), as PaperTrail.examIdFor
    return this.examIdFn(board, salt);
  }
  examIdFn: (board: Hex, salt: Hex) => Hex = () => '0x';
  private boardFor(examId: Hex): Hex | undefined {
    return this.boards.get(examId?.toLowerCase()) as Hex | undefined;
  }

  async nonceOf(signer: Hex) {
    return this.nonces.get(signer.toLowerCase()) ?? 0n;
  }
  async pqcKeyStatus(a: Hex) {
    const k = this.registered.get(a.toLowerCase());
    return k ? { registered: true, algorithmId: 1, pubkey: toHex(k.pq.publicKey) } : { registered: false, algorithmId: 0, pubkey: '0x' as Hex };
  }
  async pqcVerify(pk: Hex, sig: Hex, msg: Hex) {
    return pqVerify(fromHex(pk), fromHex(msg), fromHex(sig));
  }
  async kemKey(address: string) {
    for (const k of this.registered.values()) if (k.address === address) return k.seal.mlkemPublicKey;
    return undefined;
  }
  qor(evm: string) {
    return this.registered.get(evm.toLowerCase())?.address ?? 'qor1unknown';
  }
  async centreEpoch(board: Hex, groupId: Hex) {
    return this.epochs.get(`${board.toLowerCase()}|${groupId.toLowerCase()}`) ?? 0;
  }
  async nativeTx(hash: string) {
    return this.nativeTxs.get(hash.toUpperCase());
  }
  async windowNeedsReopen() {
    return this.needsReopen;
  }
  async openWindow() {
    this.opened++;
    this.needsReopen = false;
    return 'WINDOWTX';
  }
  async windowStatus() {
    return { found: true, live: true, remainingTxs: 40n, remainingBlocks: 9000n, remainingValue: 4_000_000n, allowedTargets: [this.address.toLowerCase()] };
  }
  async relayerBalanceWei() {
    return 10n ** 18n;
  }
}
