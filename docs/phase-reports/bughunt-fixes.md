## Bug-hunt fixes (Phases 0–5)

The review reported 10 findings: 3 high, 3 medium, 4 low. All 10 are fixed, along with the spec gaps it listed. I checked each finding against the code before fixing it, and every one held up. Each fix has a regression test, and the full live exam was re-run against a redeployed contract.

### Results
- **Tests:**
  - contracts **47/47** (+1: the stale-epoch release, mutation-checked);
  - core **63/63** (+1: a detector tie);
  - shared 4/4;
  - api **24/24** (+9 regression tests in `bughunt.spec.ts`, 6 green runs in a row).
- **Lint:** clean. Scripts typecheck.
- **PaperTrail v2 deployed:** `0xbe6b208Bc8990a68740053Dad68624914812cf8F`, block 10,485,858 ([tx](https://explore.qore.network/tx/0x5bdf9effc8834e32ed41881fb2eb58f78a49cb247bb82dc86e7938ec3fa72a15)). The new `release(…, uint64 epoch, …)` selector is present in the deployed bytecode and the old one isn't. v1 is kept as `scripts/out/deployment-v1.json`.
- **Full live exam on v2** (`pnpm full:e2e`): **passed**. Exam `0xb1a49033…aa37`, 19 relayed transactions. The run now verifies every group's recipients against the chain before sealing (both centres and the markers) and admits scripts with board tickets. The audit timeline matches the earlier run.
- **Live finding-1 check** (`scripts/findings/stale-epoch.ts`, simulation only): on that exam, centre A is at epoch 2 after A2's removal. A release signed for **epoch 1 reverts `BadEpoch(2)`**; the same release signed for epoch 2 is accepted.

### Findings → fixes

| # | Severity | Fix | Where | Test |
|---|---|---|---|---|
| 1 | High | **The release epoch is signed and enforced on-chain.** The payload is now `(examId, centreId, blobHash, examiner, epoch)` and the contract reverts `BadEpoch(current)` unless it matches. A release sealed before a removal can never land after it, whether it races the lock or is replayed. The API relays the signed epoch and no longer overwrites the indexed `releasedEpoch`. | `PaperTrail.sol`, `PaperTrailLib.sol`, core `actions.ts`, vectors, `release.service.ts` | `test_release_staleEpochRefused`, digest vectors, live `stale-epoch.ts` |
| 2 | High | **A sign-once relayer.** A session advisory lock on a dedicated `pg` connection replaces the interactive transaction, so a timeout can't drop the lock mid-send. Only reads and the simulation are retried. The raw transaction is signed once, and its hash is saved (`SUBMITTED`) **before** broadcast, outside any transaction. Only the same bytes are rebroadcast, which is idempotent. The receipt wait is bounded (60 s, within Vercel's 300 s); after that the error is *pending* (`sent`), callers **keep** their rows, and the cron reconciles by hash. Rotations, releases, scripts, marks roots and bindings are written as pending and confirmed by their indexed events. | `relayer.service.ts`, `lock.service.ts`, `indexer.service.ts`, all callers | `bughunt.spec.ts`: receipt timeout (rows kept, 1 signature, pending retry, reconcile → confirmed → CONFLICT); broadcast error after acceptance (one tx); pending rotation |
| 3 | High | **Recipients come from the chain, not from the API's word.** Current membership is the member list of the epoch the chain is at, counted only once its `EpochChanged` hash is indexed. A pending or failed rotation never changes who you seal to. The endpoints return signed cards, `membersHash` and `epochTx`. The new core `resolveGroupRecipients` rebuilds recipients from the `EpochChanged` receipt (fetched by hash from the RPC), the current epoch, the board-signed `membersHash`, and the cards checked against on-chain PQC and KEM keys. The reference client uses it. | `members.ts`, `groups.service.ts`, core `verify.ts`, `full-e2e.ts` | pending-rotation test; live e2e "group verified against the chain" |
| 4 | Medium | **Indexer backfill commits per chunk, with the cursor, in short transactions,** capped at 25 × 2,000 blocks per call. A long backfill progresses across calls instead of rolling back. The lock is a session try-lock. | `indexer.service.ts` | the cursor guard test, and the backfill-progress test (+50k per call, ending at head − 3) |
| 5 | Medium | **Board-issued single-use script tickets**, consumed atomically with the insert; a Postgres per-IP rate limit (30 per 10 min), shared across instances; no submissions once publishing has started. | `scripts.service.ts`, `rate-limit.service.ts` | missing, used and wrong-centre tickets refused; 31st request → 429 |
| 6 | Medium/low | **Marking is frozen first** (`marksStatus` set to PUBLISHING, atomically), the entries are **snapshotted** with the root, and then the root is checked. Proofs come from the snapshot. A definite failure reopens marking; a pending one stays frozen until `MarksPublished`. | `scripts.service.ts`, schema | mark during a pending publish → 409; proof matches the snapshot |
| 7 | Low | `Mark.updatedAt`; the latest *revision* counts. | schema, `scripts.service.ts` | M1 40, then M2 70, then M1 55 → 55 is published |
| 8 | Low | A new centre takes `currentEpoch` from the chain. | `exams.service.ts` | a reused centre shows epoch 2 |
| 9 | Low | `matchLeak` returns `copy: null` on a tie. | core `detect.ts` | tie test |
| 10 | Low | `?after` and `?role` validation → `VALIDATION_FAILED`; Prisma P2002 → `CONFLICT`; chain/RPC errors → `CHAIN_UNAVAILABLE`; anything else → `INTERNAL` (500). | `error.filter.ts`, audit, auth | bad query parameters → 400 |

### Spec gaps from the review
- **Identity map (§4.2/§7.2):** `PUT` and `GET /exams/:id/identity-map`, board only (tested).
- **"Nonce manager; retries" (§7.1):** retries now never resend a different signed transaction (finding 2).
- **D3 vs the lock:** the lock is session-level and no longer depends on a transaction timeout. The worst case per relay fits in a Vercel function.
- **Logs (§9):** relayer logs now include the action, `examId`, signer, tx hash and gas.

### On the review's spec contradictions
- **Canary attribution vs the committee bundle:** true. The README now has an honest trust model: a leaked copy that names a centre points at that centre *or* the committee.
- **D4 vs the contract:** resolved by finding 1. The epoch is part of both the AAD and the signed payload.
- **D3 vs relayer duration:** resolved by the bounded receipt wait plus reconciliation.
- **§10 "relayed by anyone":** a release relayed outside the API lands on chain, but its blob never reaches the API. This is documented as a limitation in the README.

### Deviations introduced
1. **New contract (v2) and address.** The project page lists v2. `release` takes an `epoch` argument.
2. **API bodies:** `POST /exams/:id/scripts` needs `ticket`. There's a new `POST /exams/:id/tickets` (board). `/invigilators` and `/markers` return `{board, groupChainId, epoch, membersHash, epochTx, members: [{address, roleAddress, card}]}` instead of raw keys.
3. **New error codes** `RATE_LIMITED` (429) and `INTERNAL` (500), same shape.

### Costs on diana
- Redeploy: 0.18 QOR.
- Un-narrowed window for the deploy: 0.1 QOR.
- One full e2e: about 1 QOR.

The relayer has enough for Phase 6.
