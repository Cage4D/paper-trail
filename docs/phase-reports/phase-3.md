## Phase 3 complete — Crypto core

### What was built
`packages/core` is an isomorphic TypeScript library (no Node-only imports in `src/`) that implements every §6 module on top of the official kits.

| Module | Exports | Notes |
|---|---|---|
| `actions.ts` | `Action`, `payloadHash`, `digestOf`, `examIdFor`, `buildAction`, `signAction` | Byte-for-byte equal to `PaperTrailLib`: the shared vectors plus a live `examIdFor` read from the deployed contract. ML-DSA-87, pure mode, empty context. |
| `keys.ts` | `createRoleKey`, `roleKeyFromMnemonic`, `encryptRoleKey`, `decryptRoleKey`, `wipeRoleKey` | One mnemonic yields the classical key (`deriveClassicalKey`), the canonical ML-DSA-87 key (`deriveCanonicalPqKey`) and the QoreSeal keys (`deriveSealKeys`). Same account as the SDK's `deriveUnifiedAccount`. Storage: Argon2id (19 MiB, t=2) → AES-256-GCM. |
| `register.ts` | `ensureRoleOnChain`, `roleStatus`, `recipientCardFor`, `checkRecipientCard` | Reads status first; never a second PQC registration. KEM via hybrid `MsgRegisterKEMKey`; signed recipient card for the API directory. |
| `paper.ts` | `parsePaper`, `generateCopies`, `renderCopy`, `commitmentOf`, `fingerprintTable`, `bitLayout`, `fingerprintBits` | Seeds: HKDF-SHA3. Shuffles: a SHAKE256 stream from `@qorechain/pqc` drives Fisher–Yates. Distance rule ≥ 20 bits, with up to 1,000 re-draws or a warning. Answer keys remapped per copy. |
| `split.ts` | `setExam`, `openCommitteeBundle`, `openShare` | Committee bundle sealed to 3 examiners + board. Per-centre `K_c` AES-256-GCM with aad `examId‖centreId‖commitment`. 2-of-3 Shamir; each share sealed to its examiner. `K_c` and the shares are wiped. |
| `groups.ts` | `BoardGroups` (`create`/`add`/`remove`/`rotate`, `exportSealed`/`restoreSealed`), `openGroupEpoch` | `EpochKeyManager` per group. The sealed board state holds history **and** members. A member no longer in the group gets `NOT_A_MEMBER`. |
| `release.ts` | `prepareRelease`, `openPaper`, `releaseRecipientsMatch` | **Decision D4**: each share is sealed to the centre's current invigilators. `openPaper` rebuilds `K_c` from two releases and checks the on-chain commitment (`COMMITMENT_MISMATCH`). |
| `scripts.ts` | `sealScript`, `openScript`, `newPseudonym`, `pseudonymHash`, `sealIdentityMap`, `openIdentityMap` | Scripts sealed to markers under pseudonyms; identity map sealed to the board only. |
| `detect.ts` | `matchLeak`, `normalize` | Normalise → segment → Jaccard-align (≥ 0.5) → read bits → rank copies. |
| `siwq.ts` | `createSignIn`, `signSignIn`, `verifySignIn`, `verifySignInWithChain` | SIWQ signed by the role key (decision D2). |

`fixtures/sample-paper.md` is a 12-question, 2-section paper with 18 toggles. It's the test fixture and the future judge-mode paper.

**QoreSeal purposes** (all match `^[A-Za-z0-9._:/-]{1,128}$`):

| Purpose | Sealed to | aad |
|---|---|---|
| `papertrail:committee:v1` | 3 examiners + board | examId |
| `papertrail:share:v1` | examiner *i* | examId ‖ centreId ‖ i |
| `papertrail:centre:<centreId>` | current invigilators (epoch keys) | — |
| `papertrail:release:v1` | current invigilators (released share) | examId ‖ centreId ‖ epoch |
| `papertrail:board-state:v1` | board | — |
| `papertrail:script:v1` | current markers | examId ‖ centreId ‖ pseudonymHash |
| `papertrail:identity:v1` | board | examId |

**Key wiping:** `K_c`, Shamir shares, released shares, the examSecret, Argon2 keys, decrypted plaintexts, and the role key's secret bytes (`wipeRoleKey`) are zeroed after use. JavaScript can't wipe strings or copies the engine makes, and the mnemonic string is one of those. This is documented in `keys.ts`.

### Files added / changed (path — purpose)
- `packages/core/src/{util,actions,keys,register,paper,split,groups,release,scripts,detect,siwq,index}.ts` — the library
- `packages/core/fixtures/sample-paper.md` — sample paper
- `packages/core/test/*.test.ts` (12 files) + `test/fixtures.ts` — the suite
- `packages/core/vitest.config.ts` — node + jsdom (browser export conditions) projects
- `packages/core/package.json` — kit dependencies (`@qorechain/qoresign`, `qoreseal`, `pqc`, `sdk`), `@noble/hashes`, `@noble/ciphers`, `@scure/bip39`, `shamir-secret-sharing`, `viem`
- `docs/findings.md` — decision D4 (release design)

### How to check it yourself (copy-paste commands + what you should see)
```bash
cd packages/core && CI=1 pnpm test
```
Expected: `57 passed | 2 skipped`. The skipped two are the read-only live checks.
```bash
CI=1 pnpm exec vitest run test/detect.test.ts --reporter=verbose
```
Expected: `detector accuracy: 1000/1000`.
```bash
CI=1 pnpm exec vitest run --project jsdom
```
Expected: the Shamir snapshot recorded under Node is reproduced by the browser build.
```bash
cd ../.. && set -a && . ./.env && set +a && cd packages/core && LIVE=1 NODE_OPTIONS="--no-network-family-autoselection" pnpm exec vitest run test/register.test.ts
```
Expected: the relayer's keys show as registered, read-only.
```bash
pnpm build
```
Expected: ESM, CJS and DTS all build.

### Results (tests X/Y; diana txids with explorer links)
- **`packages/core`:** 57/57, plus 2 live tests skipped offline (both pass with `LIVE=1`). By file:
  - actions 11, paper 9, flow 8, split 6, keys 5, register 4 (2 live), groups 4, scripts 3, detect 3, siwq 2;
  - shamir 2 under Node + 2 under jsdom.
- **Contracts:** 46/46. Workspace: shared 1/1, api 1/1.
- **Every spec §6 test requirement is covered:**
  - round trip of every flow;
  - a removed invigilator fails (`NOT_A_MEMBER`) on every later envelope and release;
  - one share alone can't decrypt;
  - a tampered variant fails the commitment check;
  - the digest matches Solidity (shared vectors);
  - detector accuracy;
  - Shamir output is identical under Node and jsdom.
- **Detector:** **1000/1000** correct from 3 random questions with 2–8 centres. Leaks were noisy: typos, case changes, stripped punctuation, mixed numbering, dropped options, and 10% master leaks. A probe with fewer questions gave 87% from 1 question (about 6 bits) and 99.6% from 2 (about 13 bits). Copies of the sample paper are typically about 46 bits apart, against a required 20.
- No diana transactions in this phase. `actions.ts` was checked against the deployed contract's `examIdFor`.

### Deviations from the spec (or "none")
1. **Release design (decision D4, agreed):** `prepareRelease` seals the share to the centre's current invigilators with `seal`, instead of `sealBatch` under the epoch key. Its signature takes `epoch` + `invigilators` rather than `centreEpochKey`, and `openPaper` takes `{blob, epoch}[]`.
2. **Master copy:** canonical order with every toggle on its first alternative. That's deterministic and needs no seed, and the distance rule guarantees it differs from every centre copy.
3. **`matchLeak(text, paper, tables)`:** it takes the parsed paper instead of "copies", since the canonical texts are needed for alignment. It also returns `observedBits` and the full ranking.
4. **Committee bundle contents:** examSecret, the paper markdown, the centre ids and the fingerprint tables. Copies are re-derived from these rather than stored.

### Decisions I need from you (or "none")
None.

### Known issues / TODOs carried forward
- `register.ts` uses the SDK, which pulls in cosmjs: heavy for the browser bundle. The frontend can lazy-load it.
- `scripts/register.ts` (Phase 0) still has its own copy of the registration logic. It can switch to `@paper-trail/core` once the scripts import workspace packages; that's a Phase 4 tidy-up.
- Argon2id runs on the main thread (about 0.3 s at 19 MiB). The frontend should run it in a worker.

### Next: Phase 4 — API foundation
Build the NestJS app on Vercel serverless (decision D3), with:
- Prisma schema and migrations, using the throwaway local Postgres now and Vercel Postgres later;
- `@paper-trail/shared` Zod schemas and the error catalog;
- Auth: SIWQ challenge/verify with the role key (D2) and JWT cookies, plus role binding;
- ChainModule: viem plus catch-up-on-read indexing into `ChainEvent`;
- RelayerModule: verify off-chain first, then submit, with lazy window reopen narrowed to PaperTrail, a per-signer queue and retries;
- Exams/Centres endpoints and `/health`.

Exit check: a script that creates an exam and 2 centres through the API on diana, sees the indexer store the events, and sees the relayer reopen the window by itself.

Reply "proceed" to continue.
