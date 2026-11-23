# Paper Trail: frontend handoff

You're building the web frontend for **Paper Trail**. It's an entry in the QoreChain Developer Fest (Encrypted Apps / QoreSeal category). The deadline is **2 Dec 2026, 23:59 UTC**, with submission targeted for **1 Dec**. The backend, the smart contract and the crypto library are **finished and live**. This document tells you exactly what to build, what every screen must show, and how to talk to the API.

Read the whole document before writing code. Where this document and your instincts disagree, follow the document. If something here looks wrong or impossible, stop and ask rather than working around it. Every API shape below was checked against the live deployment on 2026-11-23.

---

## 1. What Paper Trail is (the pitch the UI must make obvious)

Paper Trail is a **post-quantum chain of custody for exam papers**:

- **Each centre gets its own encrypted, fingerprinted ("canary") copy** of the paper. Questions are reordered, options are shuffled and phrasing toggles are flipped. If a copy leaks, it names its source.
- **The paper's key is split 2-of-3 between three examiners.** Two of them must release it, and only at or after the start time. The contract enforces this.
- **Released shares are sealed to that centre's current invigilators** (a QoreSeal epoch group). Remove an invigilator, and they're locked out of everything that follows.
- **Answer scripts are sealed to markers under pseudonyms.** Marks are published as a Merkle root, so every candidate can verify their own mark.
- **Every action is authorised by an ML-DSA-87 (post-quantum) signature**, verified **on-chain** by QoreChain's `pqcVerify` precompile, and recorded on QoreChain testnet (`qorechain-diana`, EVM chain id 9800).
- **The server stores only ciphertext and hashes.** It can't read a paper, and it can't forge an action.

The judges will spend about three minutes in **judge mode**. Judge mode is the product, as far as the submission is concerned.

---

## 2. Priorities (build in this order; don't start P2 until P0 and P1 are polished)

| Priority | What | Why |
|---|---|---|
| **P0** | **Judge mode**: landing → start demo → the 7 scripted beats → audit timeline, all driven by the API's `/demo/*` endpoints | This is what judges use. It needs no wallet, no keys and no funds. |
| **P0** | **Audit page** for any exam (`/exams/:id/audit`): a public timeline of on-chain events with explorer links | Proves "everything is on-chain". |
| **P1** | **Public exam page** (`/exams/:id`): exam status, centres, commitments, release counts, with live polling | Linked from judge mode and from the audit page. |
| **P1** | **"Verify a paper" tool**: paste or drop a paper text, compute SHA3-256 in the browser, compare with the on-chain commitment | The authenticity check, made tangible. |
| **P1** | **"Check my mark" tool**: pseudonym → Merkle proof → verified in the browser against the on-chain root | Blind marking, made tangible. |
| **P2** | **Real-user mode**: role key creation and encrypted storage, SIWQ sign-in, and board/examiner/invigilator/marker dashboards | Only if time allows. All the crypto already exists in `@paper-trail/core` (§9). |

**Hard rules**

- Testnet only. Label everything that touches demo keys **"DEMO — testnet only"**.
- Never implement your own crypto. Use `@paper-trail/core` (it wraps the official QoreChain kits).
- Never log, store or display secrets: mnemonics, secret keys, session tokens in URLs.
- Don't claim anything the system doesn't do (§10).
- The rules require crediting every kit used. Keep a list for the README.

---

## 3. Environment and facts

| Thing | Value |
|---|---|
| API base URL | `https://paper-trail-api.vercel.app` (configure as `VITE_API_URL`; never hardcode it in components) |
| Health | `GET /health` |
| Chain | QoreChain testnet `qorechain-diana`, EVM chain id **9800** |
| EVM RPC | `https://evm-testnet.qore.host` |
| Native REST | `https://api-testnet.qore.host` |
| Explorer | `https://explore.qore.network` (tx: `/tx/<hash>`, address: `/address/<addr>`) |
| PaperTrail contract (v2) | `0xbe6b208Bc8990a68740053Dad68624914812cf8F` (`qor1he4jpz7gny9xsaqq20dddp3yj9yp9nu0pxscg9`) |
| Faucet | `https://dashboard.qorechain.io/faucet` |
| Repo | `github.com/Cage4D/paper-trail` (pnpm monorepo). **Put the frontend in `apps/web`.** |

**CORS (action needed):** the API currently allows only `http://localhost:5173`. Develop on Vite's default port 5173. Once the frontend is deployed, its origin must be added to the API's `CORS_ORIGIN` environment variable on Vercel (comma-separated, e.g. `http://localhost:5173,https://paper-trail-web.vercel.app`). Until then, browser calls from the deployed frontend will fail with a CORS error. Tell the user the final frontend URL so they can update it.

**Auth transport:** sign-in (P2 only) returns **both** an httpOnly cookie and a `token`. The frontend and API will be on different `*.vercel.app` hosts. `vercel.app` is a public suffix, so they're **cross-site**, and a `SameSite=Lax` cookie won't be sent on `fetch`. **Use the `token` as `Authorization: Bearer <token>`.** Keep it in memory, or `sessionStorage` at most, never in `localStorage` or in URLs. Judge-mode endpoints need no auth at all.

---

## 4. Tech stack

- **Vite + React + TypeScript**, in `apps/web` as a pnpm workspace package.
- Import `@paper-trail/core` and `@paper-trail/shared` as `workspace:*` dependencies.
  - `shared` gives you the Zod request schemas, the error catalog (`ERRORS`, `errorMessage`) and the typed `PAPERTRAIL_ABI`.
  - `core` gives you the crypto. Judge mode barely needs it; the P1 tools and P2 do.
  - Run `pnpm --filter @paper-trail/core build && pnpm --filter @paper-trail/shared build` once before starting Vite.
- **viem** (already in the monorepo) for any direct chain reads, such as reading `commitment(examId, centreId)` for the verify tool.
- **QoreChain kits for the frontend (spec §11):** `@qorechain/react` and `@qorechain/qorex-types` (`+ @qorechain/qorex-rainbowkit` if you use RainbowKit). **Read each package's README in `node_modules` before using it; don't guess their APIs.** Use `@qorechain/qorex-wallet-mock` in tests. In judge mode, QoreX is optional: at most, offer "Connect QoreX" to show the user's `qor1` address (§9.5).
- Markdown rendering for paper text (e.g. `react-markdown`). Papers are Markdown; see §6.3.
- No backend code in this session. If an endpoint you need doesn't exist, stop and ask.

---

## 5. API contract

### 5.1 Conventions

- JSON in and out. Binary blobs are **unpadded base64url** strings. Hashes and ids are `0x`-prefixed 32-byte hex.
- **Every error** has this shape. `message` is human copy meant to be **shown as-is**:
  ```ts
  type ApiError = { error: { code: ErrorCode; message: string; params?: Record<string, string | number> } };
  ```
- Error codes and statuses (import them from `@paper-trail/shared`; don't copy the strings):

  | code | HTTP | message (as shown to users) |
  |---|---|---|
  | `TOO_EARLY` | 409 | "This paper is still sealed. It can be released from {startTime}." |
  | `NOT_RELEASED` | 409 | "Waiting for a second examiner to release this centre's paper ({count} of 2)." |
  | `NOT_EXAMINER` | 403 | "Only this exam's examiners can release it." |
  | `ALREADY_RELEASED` | 409 | "You've already released this centre's paper." |
  | `NOT_A_MEMBER` | 403 | "You're no longer on this centre's team, so new documents can't be opened." |
  | `COMMITMENT_MISMATCH` | 422 | "This paper doesn't match what was set. Don't use it, and report it to the exam board." |
  | `KEY_NOT_REGISTERED` | 412 | "Your post-quantum keys aren't registered yet. Finish setup first." |
  | `BAD_SIGNATURE` | 401 | "That action wasn't signed by the right key." |
  | `RELAYER_BUSY` | 503 | "The network is busy. Your action is saved and will be sent shortly." (may carry `params.txHash`: the action is pending on chain; poll, don't resubmit) |
  | `CHAIN_UNAVAILABLE` | 503 | "Can't reach QoreChain right now. Try again in a minute." |
  | `VALIDATION_FAILED` | 400 | "Some of the details sent are missing or invalid." (`params.fields` names them) |
  | `UNAUTHENTICATED` | 401 | "Please sign in first." |
  | `FORBIDDEN` | 403 | "You don't have access to this." |
  | `NOT_FOUND` | 404 | "That doesn't exist." |
  | `CONFLICT` | 409 | "That already exists." |
  | `ACTION_REJECTED` | 422 | "QoreChain refused this action: {reason}." |
  | `RATE_LIMITED` | 429 | "Too many requests. Try again in a few minutes." |
  | `INTERNAL` | 500 | "Something went wrong on our side. Try again." |

- **Latency:** every on-chain action is a real testnet transaction, typically **3–10 s**. The API can take up to about **60 s** if it has to reopen its EVM window first. `POST /demo/start` takes **15–40 s**. Use generous timeouts (at least 120 s) and always show progress. Never let the user double-submit.

### 5.2 Judge mode (P0): no auth

The server holds the **DEMO** role keys (board, 3 examiners, invigilators A1/A2/B1, markers 1/2) and performs every client step for them. It does so through the same checks real clients go through: signatures verified on-chain, recipients verified against the chain, and so on. Every on-chain step is a real diana transaction with an explorer link.

#### `POST /demo/start`

Rate limit: **5 per hour per IP** (`429 RATE_LIMITED`). Takes 15–40 s. **Beat 1.**

```ts
type DemoStart = {
  demoId: string;                     // put it in the URL: /demo/:demoId
  examId: `0x${string}`;
  startTime: string;                  // ISO; the paper unlocks then (about 90 s after start)
  startsInSeconds: number;            // countdown seed; re-read from GET /demo/:id
  centres: { A: `0x${string}`; B: `0x${string}` };
  roles: Record<DemoRole, { label: string; address: `0x${string}`; roleAddress: string /* qor1… */ }>;
  roleLinks: Record<DemoRole, string>; // suggested client routes "/demo/<id>/as/<role>"
  txs: { tx: `0x${string}`; explorer: string }[];   // createExam, setCentre ×2, rotateEpoch ×3
  variants: {
    master: string; A: string; B: string;           // full paper texts (Markdown, see §6.3)
    commitments: { master: `0x${string}`; A: `0x${string}`; B: `0x${string}` }; // SHA3-256 of each text
    minPairDistanceBits: number;                    // ≥ 20 by design; typically 45–60
    differences: {
      questions: { section: number; canonical: number; positionA: number; positionB: number; optionOrderA: number[]; optionOrderB: number[] }[];
      togglesDiffer: number; toggles: number;       // e.g. 9 of 18 phrasing toggles differ between A and B
    };
  };
  label: string;                                    // "DEMO — testnet only. Demo keys are held by this server; …"
};
type DemoRole = 'board' | 'examiner1' | 'examiner2' | 'examiner3' | 'invigilatorA1' | 'invigilatorA2' | 'invigilatorB1' | 'marker1' | 'marker2';
```
Role labels: board "Exam board", examiner1 "Examiner 1 (bot)", **examiner2 "Examiner 2 (you)"**, examiner3 "Examiner 3", invigilators "Invigilator A1/A2/B1", markers "Marker 1/2".

#### `GET /demo/:id`

Re-hydrate a demo; **poll this every 4–5 s while a demo screen is open.**
```ts
type DemoState = {
  demoId: string; examId: `0x${string}`; startTime: string; startsInSeconds: number;
  centres: { A: `0x${string}`; B: `0x${string}` };
  steps: { beat: number; name: string; at: string; ok: boolean; summary: string; txs: `0x${string}`[] }[];
  exam: ExamView;               // §5.3
  audit: string;                // "/exams/<id>/audit" (API path)
  events: string;               // "/exams/<id>/events" (API path)
};
```
`steps` is the server's log of beats done so far. **Derive which buttons are enabled from it.** Actions aren't idempotent: releasing twice gives `409 ALREADY_RELEASED`. The page must survive a reload mid-demo.

#### `POST /demo/:id/act`, body `{ as, action, params? }` (200 on success)

| `as` | `action` | `params` | Beat | Response |
|---|---|---|---|---|
| `examiner1` / `examiner2` / `examiner3` | `release` | `{ centre?: 'A'\|'B' }` (default A) | **2** before start time, **3** after | see below |
| `invigilatorA1` / `invigilatorA2` / `invigilatorB1` | `open` | — | **4** (and **5** for A2 after removal) | see below |
| `board` | `remove-invigilator` | `{ target: 'invigilatorA2' }` | **5** | `{ beat: 5, ok: true, removed, epoch, members: string[], txHash, explorer }` |
| `candidates` | `submit-scripts` | — | **5** | `{ beat: 5, ok: true, submitted: { scriptId, txHash, explorer }[], sealedTo: string[] }` |

**release, before the start time.** This is **not an HTTP error.** It returns 200 with:
```ts
{ beat: 2, ok: false, refusedByContract: true, error: { code: 'TOO_EARLY', message: string }, note: string }
```
That's the point of beat 2: the contract refused, in a real simulation, and nothing was sent.

**release, after the start time:**
```ts
{ beat: 3, ok: true, centre: 'A', count: 1 | 2, released: boolean, txHash: `0x${string}`, explorer: string }
```
If the chain's clock is a block or two behind the countdown, a release right at zero can still return the beat-2 `TOO_EARLY` shape. **Retry automatically every 3 s, up to about 20 s**, while showing "Waiting for the chain clock…".

**open:**
```ts
{
  beat: 4; as: DemoRole; centre: 'A' | 'B';
  opened: boolean; authentic?: true; commitment?: `0x${string}`; paper?: string;  // the decrypted copy (Markdown)
  error?: string;                                                               // e.g. 'NOT_A_MEMBER' when it couldn't open
  laterDocuments?: { what: string; result: 'opened' | 'NOT_A_MEMBER' | 'NOT_A_RECIPIENT' | string }[];
}
```
If the centre isn't released yet, `open` fails with `409 NOT_RELEASED` (HTTP error).

#### `POST /demo/:id/leak`, body `{ centre?: 'A' | 'B' }` (default B) (200). **Beat 6.**
```ts
{
  beat: 6;
  leakedExcerpt: string;  // a noisy retyping of 3 questions from that centre's copy (typos, caps, renumbering)
  result: { copy: 'Centre A' | 'Centre B' | 'the master copy (committee)' | null; confidence: number /* 0..1 */; matchedBits: number; observedBits: number; distanceToRunnerUp: number };
  centre: null | {
    centreId: `0x${string}`; name: string; commitment: `0x${string}`; setTx: `0x${string}` | null; setExplorer: string | null;
    epoch: number; recipients: { address: string; roleAddress: string }[]; epochTx: `0x${string}` | null; epochExplorer: string | null;
  };
  note: string;           // "Canary attribution names the centre whose copy leaked, or the committee (which holds every copy)."
}
```
Each call generates a different excerpt, so the button can be pressed more than once. `copy: null` means "no attribution" (a tie). Show that honestly.

### 5.3 Public read endpoints (P0/P1): no auth

**`GET /exams/:examId`** returns an `ExamView`:
```ts
type ExamView = {
  examId: `0x${string}`; title: string; status: 'PENDING' | 'CREATED' | 'FAILED';
  board: `0x${string}`; examiners: [`0x${string}`, `0x${string}`, `0x${string}`];
  startTime: string; masterCommitment: `0x${string}`; committeeBundleHash: `0x${string}`; createTx: `0x${string}` | null;
  centres: { centreId: `0x${string}`; name: string; commitment: `0x${string}`; cipherHash: `0x${string}`; confirmed: boolean; epoch: number; released: boolean; releaseCount: number; setTx: `0x${string}` | null }[];
};
```

**`GET /exams/:examId/audit`**
```ts
{
  examId; contract: `0x${string}`; chainId: 9800;
  timeline: { name: 'ExamCreated' | 'CentreSet' | 'EpochChanged' | 'ShareReleased' | 'Released' | 'ScriptSubmitted' | 'MarksPublished' | string;
              block: string; logIndex: number; cursor: string; centreId: `0x${string}` | null; data: Record<string, unknown>; txHash: `0x${string}`; explorer: string }[];
  check: { how: string; masterCommitment: `0x${string}`; centres: { centreId; name; commitment; cipherHash }[]; marksRoot: `0x${string}` | null };
}
```

**`GET /exams/:examId/events?after=<block>:<logIndex>`** is the polling feed (there's no SSE): `{ events: [same items as timeline], cursor: string | null, pollAfterMs: 4000 }`. Pass back the last `cursor` as `after`. A malformed `after` gives 400.

**Other public reads:**
- `GET /exams/:examId/centres/:centreId/cipher` → `{ cipherBlob, cipherHash, commitment }`.
- `GET /exams/:examId/marks/proof?pseudonym=<ps_…>` → `{ pseudonymHash, score, proof: string[], merkleRoot, publishTx }` (404 until marks are published).
- `GET /health` → `{ ok, warnings: string[], contract, db, rpc, relayerBalanceQor, window, indexerLagBlocks }`.

`/health` is a good source for a small status chip ("QoreChain testnet: live · relayer 6.1 QOR"). Show `warnings` if present.

### 5.4 Authenticated endpoints (P2 only; summary)

All take `Authorization: Bearer <token>`. Bodies are the Zod schemas in `@paper-trail/shared` (`CreateExamBody`, `SetCentreBody`, `RotateBody`, `RemoveMemberBody`, `ReleaseBody`, `ScriptBody`, `TicketsBody`, `SubmitScriptsBody`, `MarkBody`, `PublishMarksBody`, `IdentityMapBody`, `BindBody`). Validate with them client-side before sending.

| Who | Endpoints |
|---|---|
| Anyone | `POST /auth/siwq/challenge {address: qor1…}` → `{message}`; `POST /auth/siwq/verify {message, signature}` → `{user, token}`; `POST /auth/logout`; `GET /directory?role=invigilator\|marker` |
| Signed in | `POST /me/role {sealCard}`; `GET /me/role/status`; `POST /me/bind/challenge` → `{nonce, memo}`; `POST /me/bind {qorexAddress, txHash, signature}` |
| Board | `POST /exams`; `POST /exams/:id/centres`; `POST /groups/:groupKey/members`; `DELETE /groups/:groupKey/members/:address`; `GET /board/state`; `POST /exams/:id/tickets`; `GET /exams/:id/scripts/pending`; `POST /exams/:id/scripts/submit`; `GET /exams/:id/marks`; `POST /exams/:id/marks/publish`; `PUT/GET /exams/:id/identity-map` |
| Examiner | `GET /exams/:id/committee`; `GET /exams/:id/centres/:cid/my-share`; `POST /exams/:id/centres/:cid/release` |
| Invigilator (public read) | `GET /exams/:id/centres/:cid/invigilators`; `GET /exams/:id/centres/:cid/released` (409 `NOT_RELEASED` until `Released` is on-chain) |
| Candidate (no session; needs a board-issued ticket) | `GET /exams/:id/markers`; `POST /exams/:id/scripts` |
| Marker | `GET /exams/:id/scripts`; `POST /scripts/:id/marks` |
| Groups (public) | `GET /groups/:groupKey/epochs?board=&since=` |

---

## 6. Screens (P0 and P1)

### 6.1 Landing `/`

- One-sentence promise: **"A post-quantum chain of custody for exam papers."**
- Three to four feature lines matching §1: canary copies, 2-of-3 time-locked release, revocable invigilator groups, everything ML-DSA-87-signed and verified on-chain.
- A primary button, **"Start the 3-minute demo"** → `POST /demo/start` → navigate to `/demo/:demoId`.
- Secondary links: "View an exam's audit trail" (paste an exam id), "Verify a paper", "Check my mark".
- Footer: the testnet badge, the contract address with an explorer link, the health chip, and "Built on QoreChain" with the badge from the repo README.

### 6.2 Judge mode `/demo/:demoId` (the core screen)

Layout: a **vertical stepper with the 7 beats**, a **live countdown** to `startTime`, a **role switcher** ("You are: Examiner 2") and a persistent **"DEMO — testnet only"** banner. Every beat card shows its status (pending, running, done, refused), its human summary, and **every tx hash as an explorer link**, shortened (`0x1234…abcd`) with a copy button.

| Beat | Trigger | What to show |
|---|---|---|
| **1 · Set** | done by `/demo/start` | "Exam set: 2 centres, each with its own encrypted canary copy; key split 2-of-3 between examiners." Show the six txs. Show the **canary diff**: A and B side by side (§6.3), questions in different orders, toggled phrases highlighted, the "≥ N bits apart" stat, and the three commitments. |
| **2 · Try to release early** | button "Release as Examiner 1 now" (enabled before the countdown ends) → `act examiner1 release` | Big red refusal: **"Refused by the contract: This paper is still sealed…"**, plus the note "real simulation on QoreChain; nothing was sent". |
| **3 · Start time** | countdown hits 0 → auto-run `act examiner1 release` (the bot), then **the judge clicks "Release as Examiner 2 (you)"** → `act examiner2 release` | "Examiner 1 released (1 of 2)" → after the judge's click, **"Released ✓ (2 of 2)"** with both tx links. |
| **4 · Invigilator view** | button "Open as Invigilator A1" → `act invigilatorA1 open` | Render the decrypted paper and a large **"Authentic ✓"** badge, with the commitment it matched ("SHA3-256 matches the commitment recorded on-chain"). |
| **5 · Revoke** | three buttons in order: "Remove Invigilator A2" (`act board remove-invigilator {target:'invigilatorA2'}`), "Candidates submit scripts" (`act candidates submit-scripts`), "Try to open as A2" (`act invigilatorA2 open`) | Epoch 1 → 2 with the tx; 6 script txs ("sealed to the 2 markers, verified against the chain"); then A2's attempt, showing `laterDocuments` as red ✗ rows: "centre A group key, epoch 2 → NOT_A_MEMBER", "a candidate script → NOT_A_RECIPIENT". **Be honest:** if A2's response also shows the paper as opened, explain "A2 could read the paper released while A2 was still a member (epoch 1); removal locks A2 out of everything after." |
| **6 · Leak** | button "Simulate a leak from Centre B" → `POST /demo/:id/leak` | Left: the noisy leaked excerpt (monospace, as given). Right: **"Traced to Centre B"**, the confidence bar, "23/23 fingerprint bits matched", the centre's current epoch and recipients, and tx links. Repeatable. |
| **7 · Audit** | link/tab → the audit page for `examId` | §6.4. |

Behaviour:
- **Poll `GET /demo/:id`** every 4–5 s and derive the state from `steps` and `exam`. Reloading must restore the exact state.
- Disable each button while its call runs. Never send the same act twice; buttons for completed beats become disabled ✓.
- The countdown uses `startTime` from the server. When it reaches 0, run the examiner-1 bot release automatically, with the retry rule from §5.2.
- On `RATE_LIMITED` from start: "The demo is limited to 5 runs per hour. Open the last demo instead." If you have a recent demo id (`sessionStorage`), offer a link to it.
- On `RELAYER_BUSY` with `txHash`: show "Saved — sending to QoreChain…", keep polling `GET /demo/:id`, and **don't** resend.
- Total judge time should be about 3 minutes, and most of it is the 90 s countdown. While it runs, encourage reading the canary diff ("While the paper is sealed, look at how Centre A's and B's copies differ…").

### 6.3 Rendering paper texts

Papers are Markdown:
```
# Title
## Section heading
intro line(s)
Q1: question stem
- [ ] option
- [ ] option
```
- Copies contain **no answer marks**; never mark any option correct.
- For the A/B diff, use `variants.differences.questions` to draw arrows or labels: "Q3 in A is Q7 in B", and the option order permutations.
- Highlight words that differ between A and B (a simple word diff between corresponding questions is enough).

### 6.4 Audit `/exams/:examId/audit`

- A timeline of `timeline[]`, oldest first: event name as a chip, block number, relative time if you resolve block times, or just block numbers, a decoded summary of `data` per event type (e.g. `ShareReleased`: "examiner 0x4f15… released for centre A at epoch 1"), and the tx explorer link.
- Live: poll `/events?after=cursor` every `pollAfterMs` and append new events.
- The `check` panel: `check.how` as text, the master commitment, each centre's commitment and cipher hash, and the marks root. Link to "Verify a paper".
- Show the contract address with an explorer link and "chain id 9800".

### 6.5 Exam page `/exams/:examId` (P1)

The `ExamView` as a header (title, status, start time with countdown, board, three examiners) plus a centre table (name, commitment, cipher hash, epoch, release count "1 of 2", Released ✓). Poll every 5 s. Link to the audit page.

### 6.6 Verify a paper `/verify` (P1)

Inputs: exam id, centre id (or pick from `GET /exams/:id`), and the paper text (paste or file drop). Compute `commitmentOf(text)` from `@paper-trail/core` (SHA3-256 of the exact UTF-8 bytes) and compare it with the centre's `commitment` from the API **and** directly from the chain, reading `commitment(examId, centreId)` on the contract with viem and `PAPERTRAIL_ABI`. Show ✓ "Matches the on-chain commitment" or ✗ "Doesn't match — don't use this paper." Explain that a single changed character fails the check.

### 6.7 Check my mark `/marks` (P1)

Inputs: exam id and pseudonym (`ps_…`). `GET /exams/:id/marks/proof?pseudonym=` → verify **in the browser** with `verifyMarkProof(merkleRoot, { pseudonymHash, score }, proof)` from `@paper-trail/core`. Also read the root from the `MarksPublished` event on the audit page and show that it's the same root. Show the score with ✓ "Proven against the root published on-chain" and the publish tx link.

---

## 7. Visual and UX requirements

- Clean, calm and serious: an exam-board tool, not a crypto casino. Light and dark themes. Make it work at phone width, because judges may open it on a phone.
- Status colours: green ✓ for authentic/released, red ✗ for refused/locked out, amber for waiting/pending.
- Every on-chain thing is clickable to the explorer. Addresses and hashes are shortened with a copy button and a full value on hover.
- Plain language first, technical detail second (an expandable "What happened on-chain" under each beat: the function called, the event emitted, "ML-DSA-87 signature verified by the `pqcVerify` precompile").
- Accessibility: buttons have text labels, focus states are visible, status isn't conveyed by colour alone.

---

## 8. Errors, loading and resilience

- Wrap every call in a single `api()` helper that parses `ApiError` and throws a typed error with `code`, `message` and `params`. Show `message` verbatim (it's the catalog copy).
- Map `CHAIN_UNAVAILABLE`/`INTERNAL` to a retry button. Map `RELAYER_BUSY` to the pending state, never a hard failure.
- Timeouts of at least 120 s for `/demo/start` and the acts. Show elapsed time on long steps ("Sending to QoreChain… 6 s").
- Never retry a non-idempotent POST automatically, **except** the examiner-1 bot release while it returns the beat-2 `TOO_EARLY` shape at the countdown edge.

---

## 9. P2: real-user mode (only after P0 and P1 are done)

Everything below uses `@paper-trail/core`. The API never sees secrets.

1. **Role key:** `createRoleKey()` gives a 24-word mnemonic. Show it once as a printable backup, then `encryptRoleKey(key, passphrase)` (Argon2id + AES-GCM; **run it in a Web Worker**, it takes about 0.3 s) and store the encrypted blob in `localStorage`. Unlock with `decryptRoleKey`. Never store the mnemonic in plaintext.
2. **On-chain setup:** the role's `qor1` address needs testnet QOR from the faucet (show `GET /me/role/status`'s `faucetHint`). Then `ensureRoleOnChain(roleKey)` registers its ML-DSA-87 and ML-KEM keys; it's idempotent and checks status first. It imports cosmjs, which is heavy, so **lazy-load** it. Then `POST /me/role { sealCard: recipientCardFor(roleKey) }`.
3. **Sign-in:** `POST /auth/siwq/challenge {address}` → `signSignIn(roleKey, message)` → `POST /auth/siwq/verify` → keep the `token` (Bearer).
4. **Signed actions:** build them with `buildAction(Action.X, fields, { chainId: 9800, contract, signer, nonce })`, using the signer's **current on-chain nonce** read from the contract (`nonces(signer)`), then `signAction(roleKey.pq.secretKey, digest)`. Sign one action at a time per signer, because nonces are sequential.
   - **Release (examiner):**
     1. `GET my-share`;
     2. `GET invigilators` → **`resolveGroupRecipients({...})`, which verifies the member list and cards against the chain; never seal to the API's list unverified**;
     3. `prepareRelease({..., epoch, invigilators})`;
     4. sign `Release` **including `epoch`**;
     5. `POST release`.
   - **Open (invigilator):** `GET released` → `openPaper(...)` → show Authentic ✓, or `COMMITMENT_MISMATCH`.
   - **Board:** `setExam(...)` from the Markdown paper; groups via `BoardGroups` (`exportSealed`/`restoreSealed` with `GET/…/board/state`); tickets for candidates.
   - **Candidate:** a ticket from the board, then `GET markers` → `resolveGroupRecipients` → `sealScript(...)` → `POST scripts`.
5. **QoreX:** QoreX 0.3.x **can't sign messages** for third-party sites, so sign-in uses the role key, not QoreX. Use QoreX only to read the user's address (`window.qorex.evm` `eth_requestAccounts`), or for the optional binding:
   1. `POST /me/bind/challenge` → `{memo}`;
   2. the user sends themselves 1 uqor with that memo via QoreX `signAndBroadcast`;
   3. `POST /me/bind {qorexAddress, txHash, signature}`, where the signature is the role key's over `BindIdentity(role, statementHash(bindingStatement({...})))`.

---

## 10. Honesty constraints (copy must not overclaim)

- The **exam board can read what's sealed to centre groups** (it runs them). It never gets two shares unless two examiners release.
- **Canary attribution** names the centre whose copy leaked **or the committee**: examiners and the board hold every copy. The leak result already says so; keep that note visible.
- A removed invigilator **can still read documents from before their removal**. Revocation affects everything *after*.
- Metadata is public on-chain (who did what, when, sizes); only payloads are confidential.
- QoreSeal is version 0.1.0, pending external review. Testnet only.
- Don't call the server "trustless". Say "can't read papers, can't forge actions; every action is signed and checked on-chain".

---

## 11. Acceptance checklist

- [ ] `pnpm --filter web dev` runs on `http://localhost:5173` against the deployed API.
- [ ] Landing → "Start the 3-minute demo" → all 7 beats complete, with every tx link opening on `explore.qore.network`.
- [ ] Beat 2 shows the contract's refusal (not a generic error).
- [ ] The countdown is driven by `startTime`; the examiner-1 bot release fires at zero (with the chain-clock retry); the judge's "Release as Examiner 2" produces **Released ✓**.
- [ ] Beat 4 renders the decrypted paper with **Authentic ✓** and the matched commitment.
- [ ] Beat 5 shows the epoch change and A2's red ✗ rows, with the honest note.
- [ ] Beat 6 shows the excerpt and **Traced to Centre B**, and can be repeated.
- [ ] The audit page shows every event type with explorer links and live-appends new events.
- [ ] Reloading `/demo/:id` at any point restores the exact state; no button can double-fire an action.
- [ ] "DEMO — testnet only" is visible throughout judge mode; nothing displays secrets.
- [ ] Works at phone width, in light and dark themes.
- [ ] The README lists the frontend kits and libraries used (the rules require credits).
- [ ] The deployed frontend URL is given to the user so `CORS_ORIGIN` on the API can be updated.
