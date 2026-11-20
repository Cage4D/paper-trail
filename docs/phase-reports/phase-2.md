## Phase 2 complete — Contract on diana

### What was built
- **The two Phase 1 decisions, applied before deployment** (both recommended options):
  1. **Exam IDs are namespaced by board:** `createExam` takes a `salt` and derives `examId = keccak256(board, salt)` (view: `examIdFor`).
  2. **Centre epoch groups are keyed by `(board, centreId)`.** `release` uses the exam board's group and requires epoch ≥ 1 (`NoEpochGroup`), and `EpochChanged` now indexes the board.

  The tests, vectors and docs are updated, and the new checks are mutation-tested.
- **examiner3** got 1 QOR from board (as you approved) and its PQC and KEM keys are registered. It's a supporting account, not one of the 5 listed addresses.
- **PaperTrail is deployed on diana** by the relayer: `0xDd26128846Ea6A35340010ce8be8F5820E264C33`.
- **The relayer's EVM window is reopened, narrowed with `allowedTargets = [PaperTrail]`.** The relayer can only spend on the contract (and the narrowed window refuses contract creation).
- **Live smoke test with real ML-DSA-87 signatures** by the role keys, checked by the real precompiles inside the contract:
  1. createExam;
  2. setCentre ×2;
  3. rotateEpoch;
  4. an early release (simulated: `TooEarly`);
  5. two releases, then `Released` (exactly once).
- **Negative check on the live contract:** examiner3's genuine signature passes, and the same signature with one byte flipped reverts with `BadSignature`.
- **New scripts:** `pnpm transfer`, `pnpm deploy:papertrail`, `pnpm relayer:window [status|open]`, `pnpm smoke`, and `scripts/findings/live-negative.ts`.

### Files added / changed (path — purpose)
- `packages/contracts/src/PaperTrail.sol`, `PaperTrailLib.sol` — namespaced exam ids and per-board epoch groups
- `packages/contracts/test/*.t.sol`, `test/vectors/digest-vectors.json`, `scripts/vectors/gen-digest-vectors.ts` — updated tests and vectors (46 tests)
- `packages/contracts/PAPERTRAIL.md` — docs for the new semantics
- `scripts/lib/chain.ts` — viem clients on diana, hybrid native broadcasts, explorer URL
- `scripts/transfer.ts` — hybrid-signed QOR transfer between role accounts
- `scripts/deploy.ts` → `scripts/out/deployment.json` — deployment record (also sets `PAPERTRAIL_ADDRESS` in `.env`)
- `scripts/relayer-window.ts` — open or inspect the relayer window, narrowed to PaperTrail
- `scripts/smoke.ts` → `scripts/out/smoke.json` — the live smoke test and its results
- `scripts/findings/live-negative.ts` → `out/live-negative.json` — genuine vs forged signature on the live contract
- `docs/findings.md` — D1 confirmed live, real gas, explorer
- `scripts/out/registrations.json` — examiner3's registration

### How to check it yourself (copy-paste commands + what you should see)
```bash
cd packages/contracts && forge test
```
Expected: `46 tests passed, 0 failed`.
```bash
cast call 0xDd26128846Ea6A35340010ce8be8F5820E264C33 "ML_DSA_87()(uint8)" --rpc-url https://evm-testnet.qore.host
```
Expected: `1`.
```bash
cast call 0xDd26128846Ea6A35340010ce8be8F5820E264C33 "releasedCentre(bytes32,bytes32)(bool)" 0x784d6519265eed3d17386a7ce8a1a904c222bc5ffa7f6f34008d9964c14e270e $(node -p "require('./scripts/findings/out/live-negative.json').centreA") --rpc-url https://evm-testnet.qore.host
```
Run from the repo root. Expected: `true`.
```bash
pnpm relayer:window status
```
Expected: `live`, with `allowedTargets` holding only the PaperTrail address.
```bash
NODE_OPTIONS="--no-network-family-autoselection" pnpm tsx scripts/findings/live-negative.ts
```
Expected: the genuine signature is `ok`, and the flipped one gives `BadSignature`. Nothing is sent.

For a full re-run, `pnpm smoke` creates a fresh exam. It sends 6 transactions and takes about 3 minutes.

### Results (tests X/Y; diana txids with explorer links)
- **Tests:** forge 46/46, workspace Vitest 3/3. Mutation checks are caught, including M11–M14 for the new checks.
- **Diana transactions** (explorer: https://explore.qore.network, from `@qorechain/evm`'s testnet chain definition):

  | Step | Tx | gasUsed |
  |---|---|---|
  | Deploy PaperTrail | [0x862be464…ac4d](https://explore.qore.network/tx/0x862be464d94e90a4458b07314a15bc5c9068cc1cfecff7c4fbdf1cd1f6abac4d) | 1,611,276 |
  | Relayer window narrowed to PaperTrail (native) | `EC9C034CDBEA25E6C260BDA9FEE090599C787BE646CBF613BD2A091B76CD7E61` | — |
  | createExam | [0xc9575bd3…8d58](https://explore.qore.network/tx/0xc9575bd39331086da69aa01c0df27a0f508f7cba375ea8c296842eb09ba58d58) | 421,307 |
  | setCentre A | [0x2be1ab34…49b3](https://explore.qore.network/tx/0x2be1ab341a5ebc09af24d209abb97f39fe16f455fa1a1c869e12ac0c53bb49b3) | 255,003 |
  | setCentre B | [0x8422a754…b45b](https://explore.qore.network/tx/0x8422a754d453011732e8b644ed67533ea3ef1cd991c43c4e02bb4caaabbcb45b) | 254,907 |
  | rotateEpoch A → 1 | [0xebf9b842…bd5c](https://explore.qore.network/tx/0xebf9b842b6162eeb1b8951493c22e7174b01acccb557fb0926ab746e0f4fbd5c) | 226,896 |
  | Early release (simulated) | reverted `TooEarly(1795177203)`, no tx | — |
  | release examiner1 | [0xe3be4043…4d69](https://explore.qore.network/tx/0xe3be40432d1eed626ee97b9d767221aec1dd9b01ab71256375fae5703eda4d69) | 279,809 |
  | release examiner2 → `Released` | [0xe2f2621e…e478](https://explore.qore.network/tx/0xe2f2621e93fb674b9debfd3ccc17caede918df3c879b917726cda7198ed8e478) | 289,040 |
  | board → examiner3, 1 QOR (native) | `4C6588511639FF1381370C20CD5B19737859D44C76418BD4DF751C663D18A5CF` | — |
  | examiner3 PQC / KEM registration (native) | `8164827E…83D7` / `A03CDC53…CE7D` | — |

- **Exam** `0x784d6519…270e`, start time 1795177203. `Released` was emitted once and `releasedCentre` is true.
- **Real gas** is about 227k–421k per action, roughly 0.025–0.05 QOR each. `pqcKeyStatus` is cheap (about 24k gas for a whole top-level call), so the cost is mostly `pqcVerify` plus the 4.6 KB signature in calldata.
- **Balances now:**

  | Account | QOR |
  |---|---|
  | relayer | 9.22 |
  | board | 8.7 |
  | examiner1 | 9.8 |
  | examiner2 | 9.8 |
  | examiner3 | 0.8 |

- **Relayer window:** 44 txs and 4.56 QOR left, expiring at height 10,449,589 (about 6.9 h after it opened).

### Deviations from the spec (or "none")
1. **Exam ID derivation** (approved decision 1): createExam's first argument is a `salt`; `examId = keccak256(board, salt)`.
2. **Per-board epochs** (approved decision 2): epoch groups are per board (`centreEpoch(board, centreId)`), the `centreBoard` mapping is removed, `EpochChanged` gains an indexed `board`, and `release` requires the exam board's group (`NoEpochGroup`).
3. **Early-release proof:** shown as a failed simulation rather than a mined failing transaction, matching judge-mode beat 2 ("show the real failed simulation"). This doesn't use up one of the window's transactions.

### Decisions I need from you (or "none")
None.

### Known issues / TODOs carried forward
- The relayer window expires about 6.9 h after each opening. The Phase 4 API reopens it lazily before relaying (decision D3), always narrowed to PaperTrail.
- For Phase 4: a signer's nonce is consumed in order, so the API must queue each signer's actions.
- Six demo accounts (invigilators A1/A2/B1, markers 1/2, and the second exam's examiners if needed) still need funding and registration before Phase 6.
- Q10 (judging rubric) is still waiting on Discord.

### Next: Phase 3 — Crypto core
Build `packages/core` per §6. It covers:
- **Role keys:** classical + ML-DSA-87 + QoreSeal keys, stored with Argon2id + AES-GCM.
- **Registration:** reuses `scripts/register.ts`'s logic.
- **Papers:** parsing, canary variants with the distance rule, and commitments.
- **Exam setup:** 2-of-3 Shamir split and sealing.
- **Board groups:** `BoardGroups` over `EpochKeyManager`, saving history and members.
- **Release and opening**, with the commitment check.
- **Scripts:** sealed scripts and pseudonyms.
- **Leak detection:** `matchLeak`.
- **Signed actions:** `actions.ts`, matching `digest-vectors.json` byte for byte (including `examIdFor`).
- **SIWQ:** wrappers that sign with the role key (D2).

The QoreSeal release context gets a valid format (findings Q7). The Vitest suite covers every flow, revocation, the detector's accuracy (≥ 95%), and Shamir in Node vs jsdom.

Reply "proceed" to continue.
