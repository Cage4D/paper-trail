## Phase 6 complete — Judge mode

### What was built
- **`DemoModule`** (spec §8). The API plays every client role for a demo exam, using the **DEMO role keys** from `DEMO_MNEMONICS`: board, 3 examiners, invigilators A1/A2/B1, markers 1/2. They are testnet only and pre-registered and pre-funded. Real users' keys are never held by the server.
  - Demo steps go through **the same services** as real clients, so every guard applies: the relayer's off-chain ML-DSA-87 check, envelope-recipient checks, the signed release epoch, `Released` gating, script tickets, and group recipients **verified against the chain** (`resolveGroupRecipients`).
  - All demo state lives in Postgres, including the demo board's sealed group state, so it works on serverless.
  - One advisory lock serialises demo steps, so two judges can't race the shared demo keys' nonces.
- **Endpoints:**

  | Endpoint | Does |
  |---|---|
  | `POST /demo/start` | **Beat 1:** creates the exam (start time **+90 s**), centres A and B, and the groups A {A1, A2}, B {B1} and markers {1, 2}. Returns both canary variants (master, A, B), a per-question diff (position, option order, toggles), the commitments, the role list with links, and the tx links. **5 per hour per IP.** |
  | `POST /demo/:id/act {as, action}` | `examiner1/2/3 · release`: before the start time this is **beat 2**, refused by a real contract simulation (`TOO_EARLY`); afterwards it's **beat 3**. `invigilatorA1/A2/B1 · open`: **beat 4**, Authentic ✓; for a removed member it also shows the later documents being refused. `board · remove-invigilator`: **beat 5**, epoch + 1. `candidates · submit-scripts`: 6 bots with tickets, sealed to the chain-verified markers, then a batch `submitScript`. |
  | `POST /demo/:id/leak {centre}` | **Beat 6:** a noisy excerpt of a centre's copy (`simulateLeak`), the detector's result, and the traced centre's epoch, recipients and tx links. |
  | `GET /demo/:id` | The beat log plus the exam view, and links to the audit timeline and events (**beat 7**). |
- **Core:** `SAMPLE_PAPER` (embedded, so the API needs no filesystem access) and `simulateLeak` (shared by the demo and the detector tests).
- **Fix found along the way:** the rate limiter (bug-hunt finding 5) compared windows using the database session's timezone. This Postgres runs in `Africa/Lagos` (UTC+1), so every window looked expired and **the limit never fired**. It now compares in UTC (`50dd153`), with a regression test.

### Files added / changed (path — purpose)
- `apps/api/src/demo/{demo.service,demo.controller,demo.module}.ts` — judge mode
- `apps/api/prisma/migrations/20261121180000_demo` — `Demo` model
- `apps/api/src/config.ts` (`DEMO_MNEMONICS`), `common/lock.service.ts` (`LOCK.demo`), `common/rate-limit.service.ts` (UTC fix), `exams`/`scripts` modules (exports)
- `apps/api/src/demo.spec.ts`, `testing/fake-chain.ts` (`getBlock`) — tests
- `packages/core/src/{sample-paper,leak-sim}.ts`, `test/sample-paper.test.ts`
- `scripts/demo-e2e.ts` → `scripts/out/demo-e2e.json` — the headless exit check (`pnpm demo:e2e`)

### How to check it yourself (copy-paste commands + what you should see)
```bash
CI=1 pnpm -r test
```
Expected: shared 4, core 65 (+2 live), api 31.
```bash
cd packages/contracts && forge test
```
Expected: 47/47.
```bash
pnpm api:dev
```
Then, in another shell:
```bash
pnpm demo:e2e
```
Live on diana, about 2.5 minutes and about 0.4 QOR of the relayer's. Expected last line: `judge mode completed headless in … s (limit 180 s)`.

### Results (tests X/Y; diana txids with explorer links)
- **Tests:** api **31/31** (+7 judge-mode tests, 4 green runs in a row), core 65/65, shared 4/4, contracts 47/47.
- **Exit check: judge mode completed headless in 155.3 s** (limit 180 s), exam `0x42a27051…271e` on PaperTrail v2:

  | t | Beat | Result |
  |---|---|---|
  | 36.5 s | 1 · set | exam, 2 centres, 3 groups; the canary copies are ≥ 55 bits apart, and 9 of 18 toggles differ between A and B. Txs: [createExam](https://explore.qore.network/tx/0x22ba384393c33caea2541e9f8c5fe3fae6d584f92b710533e4f940d804b044c1), [setCentre](https://explore.qore.network/tx/0x62747f948b8fdc435c4b9b5470f3ca39e63a692661afe07382ba303ddd0807a8) ×2, [rotateEpoch](https://explore.qore.network/tx/0xe65ad1b978dd74524b2fcd58cab7041eb4704f96fe64a63b117f3ef04c2c72fe) ×3 |
  | 41.8 s | 2 · early release | **refused by the contract:** "This paper is still sealed. It can be released from …" (real simulation; nothing sent) |
  | 100.1 s | 3 · examiner 1 (bot) | [release](https://explore.qore.network/tx/0xa3db0ec6ba593e2e8a0565eef9d346454efb3785d347f22c78405aca8a8cf916): 1 of 2 |
  | 109.1 s | 3 · judge as examiner 2 | [release](https://explore.qore.network/tx/0x84f408b8d63da3b8872609bd40a190f8af647a3a5c2d62c7a6d3eb50050811e6): 2 of 2 → **Released** |
  | 109.5 s | 4 · invigilator A1 opens | **Authentic ✓** (SHA3 matches the on-chain commitment) |
  | 114.4 s | 5 · board removes A2 | [rotateEpoch → epoch 2](https://explore.qore.network/tx/0x95c0c757775f56224fdbbf98a19143164b92781312a168e8784f191e5ed6855c) |
  | 154.4 s | 5 · 6 candidate bots | 6 scripts with tickets, sealed to the chain-verified markers; 6 `submitScript` txs (e.g. [0x7770b1d1…](https://explore.qore.network/tx/0x7770b1d1db037ef5473a3ae1be4064e267804020832404aed3b443b899162c80)) |
  | 154.7 s | 5 · A2 locked out | centre A epoch-2 group key → **NOT_A_MEMBER**; a candidate script → **NOT_A_RECIPIENT** |
  | 155.3 s | 6 · leak | noisy centre-B excerpt → **Centre B** (confidence 1.00, 23/23 bits), epoch 1, 1 recipient, tx links |
  | 155.3 s | 7 · audit | ExamCreated 1, CentreSet 2, EpochChanged 4, ShareReleased 2, Released 1, ScriptSubmitted 6 |

- **Cost:** about **0.41 QOR per demo run**. The relayer has **6.60 QOR**, enough for about 16 runs.
- **Logs:** no secrets in the API log (132 lines), including the demo mnemonics.

### Deviations from the spec (or "none")
1. **Beat 5, "A2's client can't open them":** scripts are sealed to the markers, never to invigilators, so A2 could never open them anyway. The demo shows the lock-out where it's real: A2 can't open the centre group's **epoch-2 key**, and is not a recipient of the scripts. A2 *can* still open the paper released at epoch 1, while A2 was a member. That's correct: removal blocks later documents, not past ones. The demo shows it rather than hiding it.
2. **`act` vocabulary:** `release`, `open`, `remove-invigilator` and `submit-scripts`, with `as` = a demo role or `candidates`. The frontend maps its buttons onto these.
3. **Only centre A is released in the beats**, as the spec's beats describe. The leak beat uses centre B's copy (from the committee bundle) without releasing B.

### Decisions I need from you (or "none")
1. **Relayer funding during judging (6–15 Dec).** At about 0.41 QOR per demo plus window reopens (0.1 QOR each, about 4 a day), the relayer needs roughly **2–4 QOR a day** if judges actively use the demo. It has 6.6 QOR now. Options:
   - **(a) recommended:** claim the faucet for the relayer on the days you can, and I'll make `/health` warn below 2 QOR;
   - (b) also move spare QOR from examiner1/examiner2 to the relayer now; they hold about 8 QOR each and only need a little for fees.

   Which do you want, or both?

### Known issues / TODOs carried forward
- The headless run has about 25 s of margin. Most of the time is the spec's fixed 90 s start delay plus the 6 sequential `submitScript` txs (about 40 s). A frontend that lets the judge click through, rather than auto-advance, isn't time-critical.
- Demos share the demo keys, so concurrent demos queue on the demo lock; at 5 starts per hour per IP that's acceptable.
- Vercel packaging, the cron schedule, the deployed URL and CORS are Phase 7.

### Next: Phase 7 — Deploy & hand-off
- **Deploy:** the API and DB on Vercel (D3), with the Vercel entry for Nest, Prisma migrations on Vercel Postgres, and env vars set in the project (never committed). Cron calls `POST /internal/index` (reconcile + catch-up), and CORS allows the web app.
- **Health:** an uptime ping on `/health` through 16 Dec.
- **README:** architecture, kits, network features, threat model, credits, licence.
- **Hand-off:** the list of every address for the project page (the 5 listed: relayer, PaperTrail v2, board, examiner1, examiner2).
- **Exit check:** a public `/health` that's green, and a judge-mode run on the deployed URL.

Reply "proceed" to continue.
