# Paper Trail — Backend, Contract & Crypto Core Spec (v1)

> Handoff brief for Claude Code. **Scope of this session: smart contract + crypto core library + API/relayer + demo bots.** The frontend is built in a separate session. This spec defines the API, the data the UI needs, and the client-side crypto steps (exported from `packages/core` so the frontend calls them; it doesn't reimplement them).
>
> Hackathon: **QoreChain Developer Fest, Encrypted Apps (QoreSeal)**. Deadline **2 Dec 2026, 23:59 UTC**; target submission **1 Dec**. Build window is open; all code is written from 20 Nov. Network: **testnet only** (`qorechain-diana`, EVM chain ID 9800). No mainnet, no real money.
>
> Product context and pitch: `claude/paper-trail-spec.md`. **Where the two differ, this file wins** (it replaces that spec's §5, §6, §8 and §10).
>
> **Build in phases (§12).** Finish one phase, post a Phase Report, **stop**, and wait for "proceed".

---

## 1. Product in one paragraph

A post-quantum chain of custody for exams. Each centre's copy of the paper is encrypted when it's set. Its key is split 2-of-3 between the examiners, and two of them must release it at the start time. Each centre's copy is **fingerprinted** (canary copy) so a leak names its source. Invigilators form a **QoreSeal epoch group**: remove one and they're locked out of everything that follows. Answer scripts are sealed to markers under pseudonyms. Every action is **authorised by an ML-DSA-87 signature verified on-chain** by the `pqcVerify` precompile and recorded on QoreChain. **The server stores only ciphertext and hashes. It can't read a paper and can't forge an action.**

## 2. Verified platform facts (from the published npm packages, 20 Nov)

| Fact | Source |
|---|---|
| EVM precompiles: `pqcVerify` at `0x…0A01` (`pqcVerify(bytes pubkey, bytes signature, bytes message) view returns (bool)`), `pqcKeyStatus` at `0x…0A02` (`pqcKeyStatus(address) view returns (bool registered, uint8 algorithmId, bytes pubkey)`). **Both active on diana** (not on mainnet). | `@qorechain/evm` 0.14.0 `PRECOMPILE_ADDRESSES`, `IQORE_PQC_ABI`, README |
| **Every EVM tx needs a registered ML-DSA-87 key and a live authorisation window** for the sender, opened by a hybrid-signed native-lane message (`openEvmWindowMessage`, `evmWindowStatus`, `classifyEvmWindowRejection`). | `@qorechain/evm` README |
| Hybrid native signing: `deriveClassicalKey`, `deriveCanonicalPqKey`, `signHybrid`; network helpers `fetchPqKeyStatus`, `broadcastTx`, `simulateTx`, `resolveSignBytesVersion`. | `@qorechain/qoresign` 0.2.0 |
| Sign In With QoreChain: `createSiwqMessage`, `signSiwq`, `verifySiwq`, `verifySiwqWithChain`. | `@qorechain/qoresign` |
| PQC key registration: `ensurePqcRegistered` (idempotent; **a second registration is refused after the fee is charged**). | `@qorechain/sdk` README |
| QoreSeal: `seal`/`open` (hybrid ML-KEM-1024 + X25519, ≤ 1024 recipients, `purpose` + `aad`), `sealToAddresses`, `fetchKemKey`, `buildRegisterKemKeyMessage`, recipient cards (`signRecipientCard`, `verifyRecipientCard`), `EpochKeyManager` (`addMember`/`removeMember`/`rotate`, `exportKeys`, `history`), `sealBatch`/`openBatch`/`PrivateBatchCodec`, `sealEpochKey`/`openEpochKey`. Envelopes are **not signed**; only the payload is confidential; pre-audit (0.1.0). | `@qorechain/qoreseal` 0.1.0 |
| QoreX: `@qorechain/qorex-types` (detection, EIP-1193/6963 + native provider), `@qorechain/qorex-rainbowkit` (viem chain defs), `@qorechain/qorex-wallet-mock` (test double with real hybrid ML-DSA-87 signing on testnet). | npm |
| Faucet: one claim per account per 24 h; wants `qor1…` addresses. REST testnet: `https://api-testnet.qore.host`. | build.qorechain.io/faq, QoreSeal README |

## 3. Key architecture decisions

1. **Signature-authorised contract, untrusted relayer.** Every state change carries an **ML-DSA-87 signature by the role holder** over a domain-separated digest. `PaperTrail.sol` checks the signer's registered key through `pqcKeyStatus` and verifies the signature through `pqcVerify`. One **relayer account** (holds the EVM window, pays gas) submits all txs. So users never need their own EVM window or gas, a compromised relayer can't forge anything, and the "Solidity PQC signature check" and "Solidity PQC key status" network features are both genuinely used.
   - **Fallback (decide in Phase 2):** if `pqcVerify` refuses ML-DSA-87-sized input (pubkey 2,592 B, sig 4,627 B) because of `precompileInputMaxBytes` or gas, switch to `msg.sender` auth with per-role EVM windows, and keep `pqcKeyStatus` gating. Record the decision in `docs/findings.md`.
2. **Role accounts are app keys, identity is QoreX.** Users sign in with QoreX (SIWQ). The app then creates a **Paper Trail key** for that user: one BIP-39 mnemonic deriving the classical key, the canonical ML-DSA-87 key (`deriveCanonicalPqKey`) and the QoreSeal keys (`deriveSealKeys`). It's stored in the browser encrypted with a passphrase (Argon2id + AES-GCM), with a printable backup. The QoreX address is bound to the role address by a SIWQ-signed statement stored by the API and hashed on-chain. *Why:* the contract must verify ML-DSA signatures over our own digests, and we can't assume QoreX exposes raw ML-DSA message signing (open question Q2; if it does, drop the app key for signing).
3. **All plaintext crypto runs on the client** (browser or a demo bot). The API stores blobs, relays signed actions and serves events. It never holds `K_c`, shares, epoch keys or seal secret keys, except the **demo keys** of judge mode, which are clearly labelled and testnet-only.
4. **Testnet-only, budget zero.** Faucet QOR only. Fund the relayer and demo accounts early (one claim per account per day).

## 4. Crypto design (implemented in `packages/core`)

### 4.1 Paper format and canary variants
- Paper = Markdown with sections; questions start with `Q:`; MCQ options `- [ ]` / `- [x]`; phrasing toggles `{{a|b}}` (examiner-authored, each one bit).
- Copies: **one master copy** (canonical order) plus **one variant per centre**. `seed_c = HKDF-SHA3(examSecret, "papertrail:variant:" + centreId)`; seed → Fisher–Yates question order within each section, MCQ option order, toggle bits. Answer keys are remapped per variant.
- `commitment_c = SHA3-256(canonical bytes of variant_c)`; `commitment_master` likewise.
- **Fingerprint table** per copy: question permutation, option permutations, toggle bits.
- **Distance rule:** reject seeds until every pair of copies differs in ≥ 20 fingerprint bits (retry up to 1,000 times; otherwise warn the examiner to add toggles).

### 4.2 Keys and sealing

| Secret | Generated by | Sealed to | Purpose string |
|---|---|---|---|
| `examSecret` + master copy + all fingerprint tables ("committee bundle") | Setting examiner | The 3 examiners + board (`seal`, multi-recipient) | `papertrail:committee:v1` |
| `K_c` (AES-256-GCM key per centre) | Setting examiner | **Not stored.** Split 2-of-3 (`shamir-secret-sharing`); share *i* sealed to examiner *i* | `papertrail:share:v1` |
| Variant ciphertext `C_c = AES-GCM(K_c, variant_c, aad = examId‖centreId‖commitment_c)` | Setting examiner | — (public blob) | — |
| Centre epoch keys | Board's `EpochKeyManager` per centre | Each rotation's envelope sealed to the current invigilators | `papertrail:centre:<centreId>` |
| Board's epoch history (`exportKeys()`) | Board | Sealed to the board only | `papertrail:board-state:v1` |
| Released share for centre c | Releasing examiner | `sealBatch` under the centre's **current** epoch key, `context = examId‖centreId` | — |
| Answer script | Candidate client | `seal` to the current markers (multi-recipient) | `papertrail:script:v1` |
| Pseudonym → candidate map | Board | Board only | `papertrail:identity:v1` |

**Honest trust model (put it in the README):** the board operates the epoch groups, so it can read what is sealed to centre groups, but it never gets two shares unless two examiners release. The master copy is readable by any committee member, since they set the paper; the master has **its own fingerprint**, so a master leak points at the committee rather than a centre. We protect the **distribution chain**.

### 4.3 Leak detection
`matchLeak(text, tables, copies) → { copy: "master" | centreId, confidence, matchedBits, distanceToRunnerUp }`. Pipeline: normalise text (case, whitespace, punctuation), segment into questions, align each question to its canonical question by token Jaccard (≥ 0.5), then read the order, option order and toggle choices and compare against every table. Runs on a committee member's client (or the demo bot). **Target:** ≥ 95% correct copy identification from 3 random questions, over 1,000 random trials with 2–8 centres.

### 4.4 Signed actions (the contract's auth)
`digest = keccak256(abi.encode(DOMAIN, chainId, contract, action, signerAddr, nonce, payloadHash))`, `DOMAIN = keccak256("PaperTrail.v1")`. The **ML-DSA-87 signature is over the 32-byte digest**, with an empty context string (to confirm Q3). `payloadHash = keccak256(abi.encode(...action fields...))`, so the contract recomputes it from calldata. Per-signer `nonce` mapping prevents replay.

## 5. Smart contract — `PaperTrail.sol` (Foundry, EVM lane, chain 9800)

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IQorePQC {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message) external view returns (bool valid);
    function pqcKeyStatus(address account) external view returns (bool registered, uint8 algorithmId, bytes memory pubkey);
}

contract PaperTrail {
    IQorePQC constant PQC_VERIFY = IQorePQC(0x0000000000000000000000000000000000000A01);
    IQorePQC constant PQC_STATUS = IQorePQC(0x0000000000000000000000000000000000000A02);
    uint8   constant ML_DSA_87 = /* confirm algorithmId in Phase 0 (Q3) */ 0;

    enum Action { CreateExam, SetCentre, RotateEpoch, Release, SubmitScript, PublishMarks, BindIdentity }

    struct Exam {
        address board;
        address[3] examiners;
        uint64 startTime;
        bytes32 masterCommitment;
        bytes32 committeeBundleHash;
        bool exists;
    }

    mapping(bytes32 => Exam) public exams;
    mapping(bytes32 => mapping(bytes32 => bytes32)) public commitment;        // exam => centre => SHA3(variant)
    mapping(bytes32 => mapping(bytes32 => bytes32)) public cipherHash;        // exam => centre => hash(C_c)
    mapping(bytes32 => mapping(bytes32 => uint8))   public releaseCount;
    mapping(bytes32 => mapping(bytes32 => mapping(address => bool))) public hasReleased;
    mapping(bytes32 => address) public centreBoard;                          // centre => board
    mapping(bytes32 => uint64)  public centreEpoch;                          // centre => epoch
    mapping(bytes32 => mapping(bytes32 => bool)) public releasedCentre;
    mapping(address => uint256) public nonces;
    mapping(address => bytes32) public identityBinding;                      // role addr => hash(SIWQ statement)

    event ExamCreated(bytes32 indexed examId, address indexed board, address[3] examiners, uint64 startTime, bytes32 masterCommitment);
    event CentreSet(bytes32 indexed examId, bytes32 indexed centreId, bytes32 commitment, bytes32 cipherHash);
    event EpochChanged(bytes32 indexed centreId, uint64 epoch, bytes32 membersHash, bytes32 envelopeHash);
    event ShareReleased(bytes32 indexed examId, bytes32 indexed centreId, address indexed examiner, uint64 epoch, bytes32 blobHash);
    event Released(bytes32 indexed examId, bytes32 indexed centreId, uint64 epoch);
    event ScriptSubmitted(bytes32 indexed examId, bytes32 indexed centreId, bytes32 pseudonymHash, bytes32 scriptHash, uint64 markerEpoch);
    event MarksPublished(bytes32 indexed examId, bytes32 merkleRoot);
    event IdentityBound(address indexed role, bytes32 statementHash);

    // _auth(signer, action, payloadHash, sig):
    //   (bool reg, uint8 alg, bytes memory pk) = PQC_STATUS.pqcKeyStatus(signer); require(reg && alg == ML_DSA_87)
    //   digest = keccak256(abi.encode(DOMAIN, block.chainid, address(this), action, signer, nonces[signer]++, payloadHash))
    //   require(PQC_VERIFY.pqcVerify(pk, sig, abi.encodePacked(digest)))
    //
    // createExam(examId, board, examiners[3], startTime, masterCommitment, committeeBundleHash, sigBoard)
    //   - all 3 examiners + board have registered ML-DSA-87 keys; examiners distinct; startTime > now
    // setCentre(examId, centreId, commitment, cipherHash, sigBoard)      - before startTime; once per centre
    // rotateEpoch(centreId, epoch, membersHash, envelopeHash, sigBoard)  - epoch == current + 1; first call sets centreBoard
    // release(examId, centreId, blobHash, examiner, sigExaminer)
    //   - examiner ∈ exam.examiners; block.timestamp >= startTime; once per examiner per centre;
    //     records the centre's current epoch; at 2 → Released (exactly once)
    // submitScript(examId, centreId, pseudonymHash, scriptHash, markerEpoch, sigBoardOrInvigilatorRelay)
    //   - only after Released for that centre (signed by the board in v1; candidates have no role keys)
    // publishMarks(examId, merkleRoot, sigBoard)
    // bindIdentity(role, statementHash, sigRole)                         - links a QoreX identity to a role key
}
```

### 5.1 Contract test matrix (Foundry; precompiles mocked with `vm.etch` + a mock that verifies with a test key table)

| # | Case | Expected |
|---|---|---|
| 1 | createExam with board + 3 registered ML-DSA-87 examiners, valid board sig | ✅ |
| 2 | createExam where an examiner has no registered key | ❌ |
| 3 | createExam with duplicate examiners / startTime in the past | ❌ |
| 4 | Any action with a bad signature | ❌ |
| 5 | Replay of a valid signed action (same nonce) | ❌ |
| 6 | Signature for another action / another contract / another chainId | ❌ |
| 7 | setCentre after startTime, or twice for one centre | ❌ |
| 8 | release before startTime | ❌ |
| 9 | release by a non-examiner | ❌ |
| 10 | Same examiner releases twice | ❌ |
| 11 | Two releases → `Released` emitted exactly once, records the current epoch | ✅ |
| 12 | rotateEpoch skipping or repeating an epoch; by a non-board signer | ❌ |
| 13 | submitScript before `Released` | ❌ |
| 14 | publishMarks by a non-board signer | ❌ |
| 15 | Relayer is a random account and all valid actions still succeed (relayer is untrusted) | ✅ |

Plus one **live** smoke test on diana in Phase 2 (real precompiles).

## 6. Crypto core — `packages/core` (TypeScript, isomorphic: browser + Node)

| Module | Exports | Notes |
|---|---|---|
| `keys.ts` | `createRoleKey()`, `roleKeyFromMnemonic()`, `encryptRoleKey(passphrase)`, `decryptRoleKey()` | classical + ML-DSA-87 (`deriveCanonicalPqKey`) + seal keys; Argon2id (`@noble/hashes`) + AES-GCM |
| `register.ts` | `ensureRoleOnChain(roleKey)` | `ensurePqcRegistered`, `MsgRegisterKEMKey`, signed recipient card; idempotent with status checks first (never double-register; costs a fee) |
| `paper.ts` | `parsePaper`, `generateCopies(paper, examSecret, centreIds)`, `commitmentOf`, `fingerprintTable` | §4.1 incl. distance rule |
| `split.ts` | `setExam({paper, examiners, board, centres})` → `{ committeeEnvelope, perCentre: {cipher, commitment, shares[3] (sealed)}, masterCommitment }` | wipes `K_c` after sealing |
| `groups.ts` | `BoardGroups` wrapping `EpochKeyManager` per centre (and markers): `add`, `remove`, `rotate`, `exportSealed()`, `restoreSealed()` | returns `{epoch, envelope, membersHash}` for the API + contract |
| `release.ts` | `prepareRelease(shareEnvelope, examinerKeys, centreEpochKey)` (examiner side); `openPaper(releasedBlobs[2], invigilatorEpochKeys, cipher, commitment)` | checks `SHA3(variant) == on-chain commitment` |
| `scripts.ts` | `sealScript(answers, markerRecipients)`, `openScript`, `newPseudonym`, `sealIdentityMap` | |
| `detect.ts` | `matchLeak` | §4.3 |
| `actions.ts` | `buildAction(action, fields)`, `digestOf(...)`, `signAction(roleKey, digest)` | must match the Solidity digest byte for byte (shared test vectors) |
| `siwq.ts` | thin wrappers over `createSiwqMessage` / `verifySiwq` | |

**Unit tests (Vitest), all required:** round-trip of every flow; a removed invigilator fails (`UNKNOWN_EPOCH` / `DECRYPTION_FAILED`) on every later envelope; one share alone can't decrypt; a tampered variant fails the commitment check; the action digest matches Solidity (vector file shared with Foundry); detector accuracy test (§4.3); Shamir output identical in Node and the browser build (run under jsdom).

## 7. API & relayer — `apps/api` (NestJS + Prisma + PostgreSQL, TypeScript)

### 7.1 Modules
- `AuthModule`: SIWQ challenge/verify, sessions (JWT, httpOnly cookie), role-key binding.
- `ExamsModule`: exams, centres, copies (cipher blobs), committee bundle storage.
- `GroupsModule`: epoch envelopes per centre/markers, sealed board state.
- `ReleaseModule`: released share blobs; serves them **only after** the on-chain `Released` event.
- `ScriptsModule`: sealed scripts, marks, identity map blob.
- `RelayerModule`: verifies a signed action **off-chain first** (`pqcVerify` via `eth_call`), then submits; handles the EVM window (auto-reopen when `remainingTxs < 3` or `remainingBlocks < 100`); nonce manager; retries; maps `classifyEvmWindowRejection`.
- `ChainModule`: viem client (`@qorechain/evm`), `@qorechain/sdk` native client, event indexer (`watchContractEvent` + backfill on boot) → `ChainEvent` table.
- `AuditModule`: public timeline per exam, built from indexed events, with tx links.
- `DemoModule`: judge mode (§8).
- `HealthModule`: `/health` (DB, RPC, relayer balance, window status, indexer lag).

### 7.2 Data model (Prisma sketch)

```prisma
model User        { id String @id @default(cuid()) qorexAddress String @unique roleAddress String? @unique sealCard Json? createdAt DateTime @default(now()) }
model Exam        { id String @id @default(cuid()) onchainId String @unique title String boardAddr String examiners String[] startTime DateTime masterCommitment String committeeBlob Bytes createTx String? status ExamStatus centres Centre[] }
model Centre      { id String @id @default(cuid()) examId String exam Exam @relation(fields:[examId], references:[id]) onchainId String name String commitment String cipherBlob Bytes cipherHash String currentEpoch Int @default(0) released Boolean @default(false) @@unique([examId, onchainId]) }
model Member      { id String @id @default(cuid()) groupKey String role Role address String active Boolean @default(true) addedEpoch Int removedEpoch Int? }
model EpochEnvelope { id String @id @default(cuid()) groupKey String epoch Int envelope Bytes membersHash String txHash String? @@unique([groupKey, epoch]) }
model BoardState  { boardAddr String @id sealedState Bytes updatedAt DateTime @updatedAt }
model ShareBlob   { id String @id @default(cuid()) examId String centreId String examinerAddr String sealedToExaminer Bytes releasedBlob Bytes? releaseTx String? @@unique([examId, centreId, examinerAddr]) }
model Script      { id String @id @default(cuid()) examId String centreId String pseudonymHash String blob Bytes scriptHash String markerEpoch Int txHash String? }
model Mark        { id String @id @default(cuid()) scriptId String markerAddr String score Int sealedFeedback Bytes? }
model IdentityMap { examId String @id blob Bytes }
model ChainEvent  { id String @id @default(cuid()) name String examId String? centreId String? data Json txHash String blockNumber BigInt logIndex Int @@unique([txHash, logIndex]) }
model RelayJob    { id String @id @default(cuid()) action String payload Json status RelayStatus txHash String? error String? createdAt DateTime @default(now()) }
```

### 7.3 REST API (contract for the frontend session; all bodies validated with Zod from `packages/shared`)

**Auth & keys**

| Method & path | Body | Returns |
|---|---|---|
| `POST /auth/siwq/challenge` | `{qorexAddress}` | `{message}` |
| `POST /auth/siwq/verify` | `{message, signature}` | session cookie, `{user}` |
| `POST /me/role` | `{roleAddress, sealCard, bindStatement, bindSig}` | `{registered: {pqc, kem}, relayTx}` (relays `bindIdentity`) |
| `GET /me/role/status` | — | PQC key, KEM key, recipient card, faucet hint |
| `GET /directory?role=` | — | Registered role addresses + recipient cards (for sealing to examiners, invigilators, markers) |

**Exams & centres**

| Method & path | Body | Returns |
|---|---|---|
| `POST /exams` | `{title, startTime, examiners[3], committeeBlob, masterCommitment, signedCreate}` | `{examId, onchainId, txHash}` |
| `POST /exams/:id/centres` | `{name, cipherBlob, commitment, shares[3] (sealed), signedSetCentre}` | `{centreId, txHash}` |
| `GET /exams/:id` | — | Public view: title, start time, centres (commitment, cipher hash, released?, epoch), release count per centre, examiners |
| `GET /exams/:id/committee` | (committee only) | `committeeBlob` |
| `GET /exams/:id/centres/:cid/cipher` | — | `cipherBlob` (public ciphertext) |

**Groups**

| Method & path | Body | Returns |
|---|---|---|
| `POST /groups/:groupKey/members` | `{address, envelope, epoch, membersHash, signedRotate, sealedBoardState}` | `{epoch, txHash}` |
| `DELETE /groups/:groupKey/members/:address` | same as above | `{epoch, txHash}` |
| `GET /groups/:groupKey/epochs?since=` | — | Envelopes for epochs (clients open the ones they can) |
| `GET /board/state` | (board only) | `sealedState` |

**Release & sitting**

| Method & path | Body | Returns |
|---|---|---|
| `GET /exams/:id/centres/:cid/my-share` | (examiner) | `sealedToExaminer` |
| `POST /exams/:id/centres/:cid/release` | `{releasedBlob, blobHash, signedRelease}` | `{count, released, txHash}`; contract enforces the time |
| `GET /exams/:id/centres/:cid/released` | — | `[releasedBlob ×2, epoch]` **only if** `Released` is indexed, else `409 NOT_RELEASED` |

**Scripts, marks, audit, events**

| Method & path | Body | Returns |
|---|---|---|
| `POST /exams/:id/scripts` | `{centreId, pseudonymHash, blob, scriptHash, markerEpoch}` | `{scriptId, txHash}` (board relays signed `submitScript` in batches) |
| `GET /exams/:id/scripts` | (marker) | Sealed scripts queue |
| `POST /scripts/:id/marks` | `{score, sealedFeedback?}` | `{ok}` |
| `POST /exams/:id/marks/publish` | `{merkleRoot, signedPublish}` | `{txHash}` |
| `GET /exams/:id/marks/proof?pseudonym=` | — | Merkle proof |
| `GET /exams/:id/audit` | — | Timeline of chain events + tx links + commitment-check helper data |
| `GET /exams/:id/events` | — | SSE: `examCreated`, `centreSet`, `epochChanged`, `shareReleased`, `released`, `scriptSubmitted`, `marksPublished` |

**Demo & ops:** `POST /demo/start` → `{examId, roleLinks}`; `POST /demo/:id/act` → `{as, action}` (bots perform the other roles); `POST /demo/:id/leak` → a simulated leaked text from a chosen centre plus the detector result; `GET /health`; `GET /admin/relayer` (admin token).

### 7.4 Error catalog (human copy the frontend shows as-is)

| Code | HTTP | Message |
|---|---|---|
| `TOO_EARLY` | 409 | "This paper is still sealed. It can be released from {startTime}." |
| `NOT_RELEASED` | 409 | "Waiting for a second examiner to release this centre's paper (1 of 2)." |
| `NOT_EXAMINER` | 403 | "Only this exam's examiners can release it." |
| `ALREADY_RELEASED` | 409 | "You've already released this centre's paper." |
| `NOT_A_MEMBER` | 403 | "You're no longer on this centre's team, so new documents can't be opened." |
| `COMMITMENT_MISMATCH` | 422 | "This paper doesn't match what was set. Don't use it, and report it to the exam board." |
| `KEY_NOT_REGISTERED` | 412 | "Your post-quantum keys aren't registered yet. Finish setup first." |
| `BAD_SIGNATURE` | 401 | "That action wasn't signed by the right key." |
| `RELAYER_BUSY` | 503 | "The network is busy. Your action is saved and will be sent shortly." |
| `CHAIN_UNAVAILABLE` | 503 | "Can't reach QoreChain right now. Try again in a minute." |

## 8. Judge mode (the 3-minute demo; backend-driven)

`POST /demo/start` creates a fresh exam with **demo role keys** (labelled "DEMO, testnet only", pre-registered and pre-funded): board, 3 examiners, 2 centres (A, B), 3 invigilators, 2 markers, 6 candidate bots. Start time = now + 90 s.

Scripted beats, triggered by the judge's clicks or auto-advancing:
1. **Set.** A sample paper with toggles; show both canary variants (diff data from `generateCopies`).
2. **Try early release** → contract reverts → `TOO_EARLY` (show the real failed simulation).
3. **Start time.** Examiner 1 releases (bot), the judge releases as Examiner 2 → `Released`.
4. **Invigilator view** → paper opens → **Authentic ✓**.
5. **Remove Invigilator A2** → epoch 2 → the bots submit scripts → A2's client can't open them.
6. **Leak.** `POST /demo/:id/leak` (centre B text with noise) → detector says **Centre B**, epoch, recipients and tx links.
7. **Audit page** with every event.

Demo keys live in env (`DEMO_MNEMONICS`), never real users' keys. Rate-limit `/demo/start` (5/hour/IP) so judges can't exhaust the relayer.

## 9. Infrastructure

- **Monorepo (pnpm):** `packages/contracts` (Foundry), `packages/core`, `packages/shared` (Zod schemas, types, error codes), `apps/api`, `scripts/`. The frontend session adds `apps/web`.
- **Hosting (free tiers):** API on a host without sleep (or with an uptime ping to `/health` every 5 min through **16 Dec**, since judging runs 6–15 Dec and finalists may get change requests), Postgres on Neon, frontend on Vercel.
- **Config:** `DATABASE_URL`, `QORE_REST`, `QORE_RPC`, `EVM_RPC`, `CHAIN_ID=9800`, `PAPERTRAIL_ADDRESS`, `RELAYER_MNEMONIC`, `DEMO_MNEMONICS`, `ADMIN_TOKEN`, `JWT_SECRET`, `CORS_ORIGIN`. Never commit or log secrets; `.env.example` only.
- **Logs:** structured, with action, txHash and examId. Never log blobs or keys.
- **Licence:** Apache-2.0 file at the root. **README credits** every kit and library (required by the rules).

## 10. Security & honesty notes (for the README and pitch)

- Relayer and API are untrusted for integrity (every action is ML-DSA-signed and checked on-chain) and blind to content (ciphertext only).
- Liveness depends on the relayer; if it's down, nobody loses data and actions can be relayed by anyone.
- The board can read centre-group content by design. Two examiners are still needed to release a paper.
- Metadata (who, when, sizes) is public on-chain; only payloads are confidential.
- QoreSeal is 0.1.0, pending external review. Timelock release was rejected because drand is not post-quantum.

## 11. Network features & kits this build must make verifiable

Kits in `package.json`: `@qorechain/sdk`, `@qorechain/react` (frontend), `@qorechain/evm`, `@qorechain/qoreseal`, `@qorechain/qoresign`, `@qorechain/qorex-types` (+ `qorex-rainbowkit` if used), `@qorechain/pqc` (use it for SHAKE/SHA3 in `core` so it's a real dependency).

Network features, each exercised from **addresses listed on the project page**: hybrid ML-DSA-87 transactions; PQC key registration; EVM window (relayer); Solidity PQC key status; Solidity PQC signature check; QoreSeal and the encryption key registry; Sign In With QoreChain.

## 12. Build plan — phases with review checkpoints (20 Nov → 1 Dec)

### 12.1 Checkpoint protocol (follow exactly)
1. One phase at a time, in order. No code for later phases.
2. At the exit criteria: **stop**, post a Phase Report (template below), commit, tag `phase-N`, then wait.
3. Continue only on an explicit **"proceed"** (or "proceed with changes: …"). Questions or silence are not approval.
4. Any blocker or deviation from this spec: **stop early and ask**. Don't improvise around it.
5. Comment anything QoreChain-specific (precompiles, windows, hybrid signing, sealing purposes).

**Phase Report template**
```
## Phase N complete — <name>
### What was built
### Files added / changed (path — purpose)
### How to check it yourself (copy-paste commands + what you should see)
### Results (tests X/Y; diana txids with explorer links)
### Deviations from the spec (or "none")
### Decisions I need from you (or "none")
### Known issues / TODOs carried forward
### Next: Phase N+1 — <name> (one paragraph)
Reply "proceed" to continue.
```

### 12.2 Phases

| Phase | Name | Scope | Exit criteria | What you review | Target |
|---|---|---|---|---|---|
| **0** | Verify & set up | Answer §13 with evidence in `docs/findings.md` (tiny scripts against diana); scaffold the monorepo; create relayer + demo accounts; faucet; register PQC + KEM keys for them; open the relayer's EVM window | Findings written; repo builds; empty tests run; **a `MsgRegisterKEMKey` tx from a listed address** (Ship Week); EVM window live | Findings, especially Q1 (precompile input size) and Q3 (ML-DSA context/algorithmId). Agree with the auth decision (§3.1) before contract work | 20–21 Nov |
| **1** | Contract | `PaperTrail.sol`, mocks, 15-case matrix, shared digest test vectors, README per function | `forge test` all green; vectors file committed | Read `_auth` and `release` line by line; check the negative tests fail for the right reason | 21–22 Nov |
| **2** | Contract on diana | Deploy via relayer; live smoke: create → setCentre ×2 → rotateEpoch → early release reverts → 2 releases → `Released` | Txids for each; real `pqcVerify` + `pqcKeyStatus` succeed; Ship Week "contract with a PQC check" passes | Explorer txs; the fallback decision if `pqcVerify` failed | 22 Nov |
| **3** | Crypto core | §6 modules + all unit tests incl. detector accuracy | Vitest green; detector ≥ 95%; digest matches Solidity | Sealing purposes, key wiping, detector report | 23–24 Nov |
| **4** | API foundation | Nest app, Prisma schema + migrations, Auth (SIWQ), role binding, Chain + indexer, Relayer (window mgmt, nonce, retries), Exams/Centres endpoints, error catalog, `/health` | Script: create exam + 2 centres through the API on diana; indexer stores events; relayer reopens the window automatically | Relayer verify-then-submit; SIWQ verification; nothing secret logged | 25–26 Nov |
| **5** | Groups, release, scripts, audit | Groups endpoints, board state, release gating on the indexed `Released` event, scripts + marks + Merkle, audit timeline, SSE | Node e2e script runs a full exam across 2 centres incl. revoke + blind marking | Release gating can't be bypassed; revoked member really fails | 27 Nov |
| **6** | Judge mode | Demo module, bots, leak simulation, rate limits | `POST /demo/start` → the scripted beats complete headless in < 3 min | Run it yourself; check every beat's tx | 28 Nov |
| **7** | Deploy & hand-off | Deploy API + DB; uptime ping; CORS for the web app; README (architecture, kits, network features, threat model, credits, licence); list every address for the project page | Public `/health` green; a judge-mode run on the deployed URL; README done | Try it from your phone; tick the kit/feature boxes that are now verifiable | 29 Nov |

Buffer: **30 Nov–1 Dec** for frontend integration fixes, the video and submission.

**Cut order if behind:** marks Merkle proofs → marker feedback → SSE (fall back to polling) → identity binding on-chain (keep it off-chain). **Never cut:** signed-action auth, 2-of-3 release with time gate, epoch revoke, canary detection, commitment check, judge mode.

## 13. Open questions — answer in Phase 0

1. Does `pqcVerify` accept ML-DSA-87 sizes (2,592 B pubkey, 4,627 B sig) within `precompileInputMaxBytes` and the gas limit? Gas cost per call?
2. Can QoreX sign arbitrary ML-DSA messages or SIWQ for us? (If raw ML-DSA message signing works, consider dropping the app role key.)
3. ML-DSA signature context string and `algorithmId` value returned by `pqcKeyStatus` for ML-DSA-87; does `pqcVerify` take the raw message or a pre-hash?
4. Do `ensurePqcRegistered` and `MsgRegisterKEMKey` work for accounts derived with `deriveClassicalKey` + `deriveCanonicalPqKey`? Fees per registration?
5. Relayer EVM window: max `blocks` / `maxTxs` per window and the cost; can a script reopen it unattended?
6. Does `sealToAddresses` against `api-testnet.qore.host` resolve both the KEM key and the recipient card, and where is the card published (on-chain or app-hosted)?
7. `EpochKeyManager` `history` restore round-trip across process restarts (for the demo bots and board state).
8. Is `shamir-secret-sharing` byte-identical in Node and the browser?
9. Free API host that allows long-running processes (indexer, SSE) without sleeping.
10. Encrypted Apps rubric: ask in Discord; note the answer in findings.

## 14. References

- Fest: https://build.qorechain.io/about · rules: https://build.qorechain.io/rules · FAQ: https://build.qorechain.io/faq · kits: https://build.qorechain.io/kits
- QoreSeal: https://github.com/qorechain/qoreseal · QoreSign: https://github.com/qorechain/qoresign · SDK: https://github.com/qorechain/qorechain-sdk
- npm: `@qorechain/qoreseal`, `@qorechain/qoresign`, `@qorechain/evm`, `@qorechain/sdk`, `@qorechain/react`, `@qorechain/qorex-types`, `@qorechain/qorex-wallet-mock`, `@qorechain/pqc`
- Docs: https://docs.qorechain.io · faucet: https://dashboard.qorechain.io/faucet
- Shamir: https://github.com/privy-io/shamir-secret-sharing
