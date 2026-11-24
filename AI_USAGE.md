# How AI was used to build Paper Trail

Paper Trail was built between 20 and 24 November 2026 by one developer working with an AI coding
agent (Claude, through Claude Code). This file says what the AI did, what the developer reviewed or
decided, and how the work was checked. Sources: the phase reports in
[`docs/phase-reports`](docs/phase-reports), [`docs/findings.md`](docs/findings.md) and the git history
(94 commits, phases tagged `phase-0` to `phase-7`).

## How the work was organised

- **Briefs written for the AI.** The developer wrote the build specification
  ([`docs/SPEC.md`](docs/SPEC.md), "Handoff brief for Claude Code"), the frontend handoff
  ([`docs/FRONTEND_HANDOFF.md`](docs/FRONTEND_HANDOFF.md)) and a visual design package. The AI worked
  from these and was told to stop and ask when they conflicted or when a choice belonged to the
  developer.
- **Phases with a report and a tag.** Each phase ended with a report (what was built, files, copy-paste
  commands to check it, decisions needed) and a git tag. The developer read each report before the next
  phase started.
- **Decisions stayed with the developer.** The AI proposed options with a recommendation; the developer
  chose. Recorded decisions include D1 (signature-authorised actions checked on chain), D2 (sign-in with
  the app role key, QoreX for the address and binding), D3 (serverless API on Vercel) and D4 (released
  shares sealed to the centre's current invigilators), plus contract changes before deployment and every
  spend of testnet funds.
- **House rules the developer set.** Conventional Commits, one commit per major step, no AI attribution
  trailers, secrets only in `.env` (never printed), testnet only, and "never implement your own crypto":
  all cryptography goes through the official QoreChain kits.

## Phase by phase

| Phase | What the AI did | What the developer reviewed or decided | How it was verified |
|---|---|---|---|
| 0 · Verify and set up | Monorepo from the official `create-qorechain-dapp` template; role accounts; PQC and KEM key registration scripts; scripts that measured platform behaviour (`pqcVerify` input sizes and gas, key status, epoch-key restore, Shamir in Node vs jsdom) | Funding of the role accounts; decisions D1–D3 from the measured findings | Findings answered with recorded evidence in [`docs/findings.md`](docs/findings.md) and [`scripts/findings/out`](scripts/findings/out) |
| 1 · Contract | `PaperTrail.sol`: every action authorised by an ML-DSA-87 signature checked with the `pqcVerify` precompile; precompile mocks; shared digest vectors generated independently with viem | Contract semantics; two design changes chosen before deployment (board-namespaced exam ids, per-board groups) | Foundry test matrix including a fuzzed untrusted relayer; 10 hand-made mutations, each caught by a test |
| 2 · Contract on chain | Deployment to qorechain-diana; relayer EVM window narrowed to the contract; live smoke test | Testnet transfers (e.g. funding examiner3) | Live smoke test with real ML-DSA-87 signatures; a one-byte-flipped signature reverts `BadSignature` on the live contract |
| 3 · Crypto core | `packages/core`: keys, registration, canary copies, sealing (QoreSeal ML-KEM-1024), 2-of-3 split, epoch groups, release, scripts, leak detection, sign-in | Decision D4 (who released shares are sealed to) | Core unit tests; actions byte-for-byte equal to the contract's digest vectors |
| 4 · API foundation | NestJS API: relayer that verifies signatures through the real precompile before sending, indexer, sign-in, exams | Serverless design (D3) | API tests against a local Postgres and a fake chain with real ML-DSA-87 verification |
| 5 · Groups, release, scripts, audit | Group rotation, release gating, scripts, blind marking with a Merkle root, audit timeline, QoreX binding | Binding flow chosen by the developer | Full live exam across two centres on qorechain-diana ([`scripts/full-e2e.ts`](scripts/full-e2e.ts)) |
| Bug hunt | Fixed all 10 findings of a review of phases 0–5 (3 high, 3 medium, 4 low), each confirmed against the code first; redeployed the contract (v2) | Which fixes to accept, and the redeployment | A regression test per finding; the full live exam re-run on v2 ([`docs/phase-reports/bughunt-fixes.md`](docs/phase-reports/bughunt-fixes.md)) |
| 6 · Judge mode | `/demo/*` endpoints that play every role with DEMO keys through the same services as real clients; deployment of the API to Vercel | That demo keys are server-held and labelled "DEMO — testnet only" | Headless judge-mode run against the deployed API within the time limit ([`scripts/out/demo-e2e-deployed.json`](scripts/out/demo-e2e-deployed.json)) |
| 7 · Web app | The React frontend from the handoff and design; later: plain-English copy, a single global nav, tablet layouts, faster demo start (setup moved to the background), and the in-browser encryption page | Design changes requested after reviewing the live site (theme, navigation, wording, illustrations, tablet layout); the backend change to the demo start | Unit tests; screenshots of every page at phone, tablet and desktop widths in both themes with a headless browser; full judge-mode runs on the deployed site against the live chain |

## How AI output was checked

- **Tests at every layer:** Foundry tests with mutation checks for the contract, unit tests for
  `packages/core`, API tests, and web tests. Tests use the real cryptography (real ML-DSA-87 signatures
  and real QoreSeal sealing), not stand-ins.
- **Live runs on qorechain-diana:** the smoke test, the full multi-role exam, the stale-epoch check and
  judge-mode runs against the deployed API all ran against the real chain, and their outputs are kept in
  [`scripts/out`](scripts/out) and [`scripts/findings/out`](scripts/findings/out).
- **The AI was asked to report honestly:** what it could not verify, when tests failed, and when a
  claim would overstate the system. The README's trust model and the honesty notes in the app came out
  of that rule.

## Limits

- Review was through the phase reports, the tests, the live runs and reading the code; this file
  doesn't claim that every line was reviewed by hand.
- QoreSeal (0.1.0) and the system as a whole have not had an external security review.
