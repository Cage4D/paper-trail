## Phase 4 complete — API foundation

### What was built
- **`packages/shared`:**
  - the error catalog (§7.4 copy exactly, plus API-level codes) and the map from contract errors to codes;
  - Zod request schemas, for example `CreateExamBody` and `SetCentreBody`, with ML-DSA-87 signature size checks;
  - the typed PaperTrail ABI, generated from the Foundry artifact (`pnpm abi`).
- **`apps/api`** (NestJS 12, Prisma 7 with the pg adapter), built for Vercel serverless (decision D3), so nothing runs in the background:
  - **Prisma schema + init migration:** §7.2 plus `AuthChallenge` (single-use SIWQ nonces) and `IndexerCursor`.
  - **ChainService:** viem on chain 9800, the `pqcKeyStatus`/`pqcVerify` precompiles, the relayer account, and the window, narrowed to PaperTrail, opened with a hybrid-signed native message.
  - **IndexerService:** catches up on read. It reads `eth_getLogs` from a stored cursor in 2,000-block chunks, stores `ChainEvent` idempotently on `txHash`+`logIndex`, and updates the exam and centre projections. It runs before reads and from `POST /internal/index` (the Vercel Cron target). A Postgres try-lock keeps concurrent runs cheap.
  - **RelayerService** (untrusted, spec §3.1). For every action it:
    1. checks the signer's key is registered;
    2. recomputes the digest with `@paper-trail/core` and the signer's on-chain nonce;
    3. **verifies the ML-DSA-87 signature through the real `pqcVerify` precompile before sending anything**;
    4. reopens the window lazily, narrowed to PaperTrail, when it is below 3 transactions, 100 blocks or 0.5 QOR;
    5. simulates (contract errors map to catalog codes), sends, and waits for the receipt.

    One Postgres advisory lock serialises all sends, which keeps each signer's nonces in order and the relayer's own. Transient RPC errors get 3 attempts, and a window refusal at send time triggers one reopen and retry. Every attempt is recorded in `RelayJob`, without blobs or secrets.
  - **Auth (decision D2):**
    - `POST /auth/siwq/challenge` issues a single-use nonce that expires in 10 minutes;
    - `POST /auth/siwq/verify` checks the role key's hybrid SIWQ signature against the ML-DSA-87 key registered on-chain, then sets a JWT httpOnly cookie (Bearer also accepted for scripts);
    - `POST /me/role` stores the recipient card after checking it against both on-chain keys;
    - `GET /me/role/status` and `GET /directory` are also here.
  - **Exams:**
    - `POST /exams` and `POST /exams/:id/centres` (board only) relay the board's signed action and roll back the database row if the relay fails;
    - `GET /exams/:id` serves the public view, catching up the indexer first;
    - `GET /exams/:id/committee` is for committee members only;
    - `GET /exams/:id/centres/:cid/cipher` serves the ciphertext.
  - **`GET /health`** reports the DB, RPC, relayer balance, window and indexer lag. **`GET /admin/relayer`** needs the admin token, compared in constant time.
  - **`ErrorFilter`:** every error goes out as `{ error: { code, message, params } }`, and internal details are never echoed.
- **Removed** the template's `@nestjs/observe` telemetry module. With placeholder keys it would have sent request data to a third-party service.

### Files added / changed (path — purpose)
- `packages/shared/src/{errors,schemas,abi,index}.ts`, `test/shared.test.ts` — catalog, schemas, ABI
- `scripts/gen-abi.ts` — `pnpm abi`
- `apps/api/prisma/schema.prisma`, `prisma/migrations/*_init` — data model
- `apps/api/src/config.ts` — validated env (testnet-only guard: CHAIN_ID must be 9800)
- `apps/api/src/common/*` — ApiError, error filter, Zod pipe, blob helpers
- `apps/api/src/{prisma,chain,relayer,auth,exams,health,internal}/*` — the modules
- `apps/api/src/app.factory.ts`, `main.ts`, `app.module.ts` — app wiring (shared by local, tests and, later, Vercel)
- `apps/api/src/api.spec.ts`, `vitest.setup.ts`, `vitest.config.ts` — integration tests
- `scripts/api-e2e.ts` → `scripts/out/api-e2e.json` — the live exit check
- `.env.example`, `README.md` — new config keys and credits; `package.json` — `abi`, `api:dev`, `api:e2e`

### How to check it yourself (copy-paste commands + what you should see)
```bash
CI=1 pnpm -r test
```
Expected: shared 4/4, core 57 passed + 2 skipped, api 9/9. The API tests need the local Postgres running.
```bash
pnpm api:dev
```
Builds and starts the API on :3000. Then, in another shell:
```bash
curl -s localhost:3000/health
```
Expected: `ok: true`, the relayer balance, the window and the indexer lag.
```bash
pnpm api:e2e
```
Live on diana (spends about 0.1 QOR of the relayer's): sign-in, card, exam, 2 centres, indexed events. Expected last line: `api e2e passed`.

### Results (tests X/Y; diana txids with explorer links)
- **Tests:** shared 4/4, core 57/57 (+2 live-only), **api 9/9**, contracts 46/46. The API tests cover:
  - the single-use SIWQ challenge, an unregistered key, and a forged ML-DSA signature;
  - a wrong-key action refused **before anything is sent**, with the row rolled back;
  - the window reopened when low;
  - `TooEarly` mapped to the catalog copy, with rollback;
  - board-only centres, the committee-only blob, and the admin guard.
- **Live exit check** (`pnpm api:e2e`), exam `0x1aa1dff7…24ba`:

  | Step | Tx | Note |
  |---|---|---|
  | Relayer window reopened by the API (native) | `0C6FF88F3BF4F6104D106024F4170F450C675DE1BF3B29D48A8BA9A7A6323388` | the previous window had expired (`live: false`); the new one is narrowed to PaperTrail |
  | createExam | [0x4bf03098…1eeb](https://explore.qore.network/tx/0x4bf03098d2e5ba19e56255e63b56deee04903127c0c6458b192ce3c525571eeb) | 404,483 gas |
  | setCentre A | [0x18331bd6…6f19](https://explore.qore.network/tx/0x18331bd6e230e90ea49ee1891e8c8a3fa1c7c8234fe5a383f303aedabc6c6f19) | 254,811 gas |
  | setCentre B | [0x8ff661df…5cae](https://explore.qore.network/tx/0x8ff661df2fe32f152b81a37a3c02099ba746b8f1309b6dbe8175f872cb8e5cae) | 254,895 gas |

  The indexer stored ExamCreated and CentreSet ×2, and `GET /exams/:id` shows `status: CREATED` with both centres confirmed. The board's recipient card passed the on-chain key check.
- **Logging:** I checked the API log of the live run for every mnemonic, the JWT secret, the admin token and the DB password: none of them appear. Logs contain only the action, signer, tx hash and gas.

### Deviations from the spec (or "none")
1. **Auth follows D2:** the challenge takes the **role** address (`{address}` instead of `{qorexAddress}`). `POST /me/role` stores and checks the recipient card. **QoreX binding is not built yet**: the `signAndBroadcast` memo transaction and the `bindIdentity` relay. Moving it to Phase 5 or cutting it is your call (decision 1 below).
2. **Hosting follows D3:**
   - the indexer catches up on read and on cron, instead of using `watchContractEvent`;
   - the window is reopened lazily inside the relay;
   - **`GET /exams/:id/events` (SSE) isn't built.** Phase 5 will offer polling instead, as the cut order allows.
3. **`/exams/:id` uses the on-chain exam id** (bytes32 hex) as `:id`. `POST /exams` returns `{ id, examId, onchainId, txHash, windowReopened }`.
4. **Request bodies:** `CreateExamBody` carries `salt` and `signature` (createExam takes a salt since Phase 2). `SetCentreBody` carries `centreId` and `signature`.
5. **Prisma client location:** generated into `apps/api/src/generated` (git-ignored) so `nest build` includes it; `postinstall` and `build` run `prisma generate`.

### Decisions I need from you (or "none")
1. **QoreX binding (D2): build it in Phase 5, or cut it?** It needs a one-time `signAndBroadcast` self-transfer from the user's QoreX wallet with a memo nonce, verified by the API, and then a relayed `bindIdentity`. The cut order already lists "identity binding on-chain (keep it off-chain)". Recommendation: cut the on-chain part for now. Sign-in with the role key is complete, and we can add the binding if there's time after Phase 6.

### Known issues / TODOs carried forward
- The relayer holds one Postgres connection, inside a transaction holding the advisory lock, for up to about 4 minutes while it waits for a receipt. That's fine at demo scale; on Vercel's free tier it caps concurrency at one relay at a time, which is intended.
- The API tests wipe the local throwaway database tables they use. Don't point `DATABASE_URL` at a real database when running `pnpm test`.
- Vercel packaging (handler entry, Cron schedule, and the Hobby plan's cron frequency limit) is Phase 7.
- No SSE (see deviation 2).

### Next: Phase 5 — Groups, release, scripts, audit
- **Groups:**
  - `POST /groups/:groupKey/members` and `DELETE …/:address`: the board relays a signed `rotateEpoch` and the API stores the envelope;
  - `GET /groups/:groupKey/epochs`;
  - `GET /board/state` for the sealed board state.
- **Release:**
  - `GET /my-share`;
  - `POST /release`, which checks recipients with `releaseRecipientsMatch` before relaying;
  - `GET /released`, which returns the blobs **only after `Released` is indexed**, otherwise `409 NOT_RELEASED`.
- **Scripts and marks:** sealed scripts, with `submitScript` relayed in batches; marks and the Merkle root and proofs.
- **Audit and live updates:** the audit timeline, and polling in place of SSE.
- **Exit check:** a Node e2e script that runs a full exam across 2 centres on diana, including a revoked invigilator who can't open, and blind marking.

Reply "proceed" to continue.
