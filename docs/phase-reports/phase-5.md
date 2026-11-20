## Phase 5 complete — Groups, release, scripts, audit (+ QoreX binding)

### What was built
- **Groups:**
  - `POST /groups/:groupKey/members` and `DELETE /groups/:groupKey/members/:address` are for the board. Before relaying the board's ML-DSA-87-signed `rotateEpoch`, the API checks three things:
    - **epoch = on-chain epoch + 1**;
    - **`membersHash` matches the new member list**;
    - **the envelope is sealed to exactly those members**, checked with QoreSeal recipient hints against their on-chain ML-KEM keys.

    Members must have signed in and published a recipient card.
  - `GET /groups/:groupKey/epochs?since=` lists the envelopes. `GET /board/state` returns the board's sealed state (history + members).
  - Marker groups use the on-chain id `SHA3("papertrail:markers:<examId>")` (core `groupChainId`).
- **Release (decision D4):**
  - `GET /my-share` is for examiners.
  - `GET /invigilators` returns the current epoch and its members' keys.
  - `POST /release` relays only after checking that the blob is sealed to exactly the exam board's current invigilators and that the epoch matches on-chain.
  - **`GET /released` returns the blobs only once `Released` is indexed**; otherwise it gives `409 NOT_RELEASED` ("… (1 of 2)").
- **Scripts and marks:**
  - `POST /exams/:id/scripts` is for candidates, with no session. A script is accepted only for a released centre, only if sealed to exactly the current markers, and only at the current `markerEpoch`.
  - The board fetches `GET …/scripts/pending` and posts `POST …/scripts/submit`, which relays the signed `submitScript` actions as a batch in nonce order.
  - Markers use `GET …/scripts` (the queue: pseudonyms only) and `POST /scripts/:id/marks`.
  - The board publishes with `POST …/marks/publish`; **the API recomputes the Merkle root from the stored marks** before relaying `publishMarks`. Candidates use `GET …/marks/proof?pseudonym=`.
- **Audit:** `GET /exams/:id/audit` is the timeline with explorer links plus commitment-check data. `GET /exams/:id/events?after=<block:logIndex>` provides polling in place of SSE (D3).
- **QoreX binding (D2, built as you chose):**
  1. `POST /me/bind/challenge` issues a memo.
  2. The user's QoreX account sends **itself** 1 uqor with that memo, using QoreX `signAndBroadcast`.
  3. `POST /me/bind` checks the transaction on-chain: success, our memo, and a MsgSend from and to the claimed address.
  4. The API rebuilds the binding statement and relays `bindIdentity(role, SHA3(statement))`, signed by the role key. The binding is recorded on-chain as `IdentityBound` and in the DB.
- **Core additions:**
  - `merkle.ts`: a sorted-pair SHA3 marks tree with proofs;
  - `binding.ts`: the memo and statement;
  - `groupChainId`;
  - `sealedToExactly`: a check that any envelope is sealed to exactly a given set of recipients.

### Files added / changed (path — purpose)
- `packages/core/src/{merkle,binding}.ts`, `groups.ts` (`groupChainId`), `release.ts` (`sealedToExactly`), `test/merkle-binding.test.ts`
- `packages/shared/src/schemas.ts` — rotate, release, script, mark, publish and bind bodies
- `apps/api/prisma/migrations/20261121000000_phase5_groups_scripts_binding` — board-scoped groups and envelopes, script and mark uniqueness, marks root, binding fields, `BindChallenge`
- `apps/api/src/groups/*` — groups, board state, member key resolution
- `apps/api/src/exams/release.service.ts` (+ routes) — release and sitting
- `apps/api/src/scripts/*` — scripts, marks, publish, proofs
- `apps/api/src/audit/*` — timeline and polling
- `apps/api/src/auth/binding.service.ts` (+ routes) — QoreX binding
- `apps/api/src/chain/indexer.service.ts`, `relayer/relayer.service.ts` — receipt ingestion, confirmation lag, cursor guard
- `apps/api/src/testing/fake-chain.ts` — a contract-emulating test double that emits real encoded logs (excluded from the build)
- `apps/api/src/phase5.spec.ts`, `api.spec.ts`, `vitest.setup.ts`, `vitest.config.ts` — tests on a separate `<db>_test` database
- `scripts/full-e2e.ts` → `scripts/out/full-e2e.json` — the live exit check; `scripts/out/registrations.json` — the five new registrations

### How to check it yourself (copy-paste commands + what you should see)
```bash
CI=1 pnpm -r test
```
Expected: shared 4, core 62 (+2 live), api 15. The API tests use the `papertrail_test` database on the local Postgres.
```bash
cd packages/contracts && forge test
```
Expected: 46/46.
```bash
pnpm api:dev
```
Then, in another shell:
```bash
pnpm full:e2e
```
Live on diana, about 6 minutes. It spends about 1 QOR of the relayer's and ends with `full e2e passed`.

### Results (tests X/Y; diana txids with explorer links)
- **Tests:**
  - api 15/15 (6 consecutive green runs after the fixes below);
  - core 62/62;
  - shared 4/4;
  - contracts 46/46.
- **Live exit check** (`pnpm full:e2e`), exam `0xc4699e7e…7679`, 19 relayed EVM transactions plus the native binding transfer. Every action was ML-DSA-87-signed by its role key and checked on-chain.

  | Step | Result |
  |---|---|
  | 11 role keys sign in (SIWQ) and publish cards | ✅ |
  | createExam, setCentre A/B | [0x64406374…](https://explore.qore.network/tx/0x64406374f2a42090b6a49bce57a3b449ccad612e4909fc6dc7447467377a144a), [0x72781eef…](https://explore.qore.network/tx/0x72781eefd8d642de7bcb844215f5a73ff6a013b9fbc52c68f485354df607c950), [0xdd3e3e35…](https://explore.qore.network/tx/0xdd3e3e352ae87406f149f4d35858f776948bc37683aaa2b8135ac8fd0a0f47c1) |
  | Groups: A (A1, A2), B (B1), markers (2) → epoch 1 | [0x7a65ab65…](https://explore.qore.network/tx/0x7a65ab65f0cec77922e97e23af93b91a5f6acd52613b2eb0e052bba05a6918e8), [0xd0f153d2…](https://explore.qore.network/tx/0xd0f153d2e2b623e06276afc5d85f987679a7b9f5fcbbae2d1444155f662ce05b), [0xb32d2a80…](https://explore.qore.network/tx/0xb32d2a804392b43d32526f6bdb5d2d229341e4c1c208cb9ab6937ee3b860d352) |
  | Early release | refused by the contract: `TOO_EARLY` with the catalog copy |
  | A: release by examiner1 (epoch 1) | [0x74eb0511…](https://explore.qore.network/tx/0x74eb0511b845595fb4691b2f9567037ceeb4300b2e3cce3ed4bdaa3408c44ff1); `/released` → "(1 of 2)" |
  | Board removes A2 → epoch 2 | [0x8f0cd839…](https://explore.qore.network/tx/0x8f0cd839243bb67865e15bb64a5e962b247b443d33c6d841f80f200aff4c571d) |
  | A: release by examiner3 (epoch 2) → Released | [0x5ce33af3…](https://explore.qore.network/tx/0x5ce33af366d147dcc1e47a230405a6af195d918e93cb6058dabd0c7d4b2e8ffc) |
  | B: releases by examiner1, examiner2 → Released | [0xda93e89b…](https://explore.qore.network/tx/0xda93e89b32a0aeaa4cf28f7e5dd96d7e7ae9b67bb5854af0d6d1599757492c3e), [0x2b610382…](https://explore.qore.network/tx/0x2b610382ca81df08de08630c1b068dcdc1ea9313c303029823a861ba83071cbf) |
  | A1 opens A, B1 opens B | **authentic** (match the on-chain commitments) |
  | Removed A2 opens A | **refused: `NOT_A_MEMBER`** |
  | 5 scripts sealed to markers → batch submitScript ×5 | e.g. [0xd54ced12…](https://explore.qore.network/tx/0xd54ced1221f56ec780b8140e560fac7348676a43dd9f4d023b602fcfe8f26d98) |
  | Blind marking (pseudonyms only) → publishMarks | [0x21cbde26…](https://explore.qore.network/tx/0x21cbde267ad79988eae386a16e88246b8bdd1bd60ecefeaff4b1995af1cddce0); a candidate's proof verifies |
  | Leak excerpt of centre B's copy | traced to **centre B** (confidence 1.00, 23/23 bits) |
  | QoreX binding | self-transfer `CA3DEE5D…F4C9` (native) + [bindIdentity 0x5775ba11…](https://explore.qore.network/tx/0x5775ba115ea9c671b520a5dfa7b3cd5adc2037912abb013780ada2056e290d0f) |
  | Audit timeline | ExamCreated 1, CentreSet 2, EpochChanged 4, ShareReleased 4, Released 2, ScriptSubmitted 5, MarksPublished 1 |

- **Funding** (your approval): 0.5 QOR each to invigilators A1/A2/B1 (from examiner1) and markers 1/2 (from examiner2), then PQC and KEM registration for all five. **Relayer balance now: 7.88 QOR.**
- **Logs:** the live API log (118 lines) contains no secrets.

### Bugs found and fixed during this phase
1. **The API tests shared the development database** and left the indexer cursor at the fake chain's height (20,000,013). The live API then stopped indexing diana (10.46M), so `Released` was never seen; that's how the first live run failed. **Fix:**
   - tests now always run on a separate `<db>_test` database;
   - the indexer warns and rescans when its cursor is ahead of the head, with a regression test.

   After the restart, the guard recovered the stuck exam: 23 events, both centres released.
2. **A race between `Released` gating and the indexer:** RPC head lag plus the 3 s throttle meant a just-released centre could still answer `NOT_RELEASED`; that's how the second live run failed. **Fix:**
   - the relayer feeds each confirmed receipt's PaperTrail logs to the indexer (idempotent);
   - `/released` forces one catch-up before returning 409;
   - cursor catch-up trails the head by 3 blocks, so a lagging load-balanced node can't make it skip logs.
3. `/released` returned blobs in an unspecified order; now sorted by epoch, then examiner. Also, a test-only 10 s hook timeout was too short for the 11-user setup.

### Deviations from the spec (or "none")
1. **Group bodies:** `addresses[]` (multiple members per rotation, which creation needs) instead of a single `address`, plus `role`; the board address comes from the session. `GET /groups/:groupKey/epochs` takes `?board=` when several boards share a group key.
2. **Release body:** `{releasedBlob, blobHash, epoch, signature}`, adding `epoch`. New `GET …/invigilators` endpoint.
3. **Scripts:** the spec's single `POST /exams/:id/scripts` is split into candidate submission plus the board's pending and submit endpoints, since the board must sign each `submitScript`. New endpoints `GET /exams/:id/markers` and `GET /exams/:id/marks` (board entries).
4. **No SSE:** polling `GET /exams/:id/events?after=` replaces it (D3, allowed by the cut order).
5. **QoreX binding as built:** the API checks the memo transaction's success, memo, and sender = recipient = the claimed address. It doesn't separately check that the transaction carried a hybrid ML-DSA layer. The chain verified the QoreX account's signature, and the binding's PQC strength comes from the role key's ML-DSA signature on `bindIdentity`. In the live run, examiner2's native account stood in for a QoreX wallet, because QoreX only runs in a browser. The frontend will use the real `signAndBroadcast`.

### Decisions I need from you (or "none")
None.

### Known issues / TODOs carried forward
- Groups hold their scripts and keys per **board**. The same invigilator can sit in groups of different boards; the directory's role filter is per membership.
- The relayer serialises all sends; a batch of N scripts takes about N × 5 s.
- The judge-mode bots (Phase 6) reuse this flow headlessly. Demo funding is fine: the relayer has 7.88 QOR, at about 1 QOR per full run.

### Next: Phase 6 — Judge mode
- `POST /demo/start` creates a fresh exam with the demo role keys (DEMO, testnet only): a start time 90 s out, 2 centres, 3 invigilators, 2 markers, 6 candidate bots.
- `POST /demo/:id/act` runs the scripted beats: set; early release refused; start; examiner 1 bot releases, the judge releases as examiner 2; invigilator view (authentic ✓); remove A2, then scripts, and A2 locked out; leak traced; audit.
- `POST /demo/:id/leak`: a noisy centre-B excerpt plus the detector result.
- Rate limits: 5 starts per hour per IP.
- Exit check: the beats complete headless in under 3 minutes.

Reply "proceed" to continue.
