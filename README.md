# Paper Trail

[![Built on QoreChain](https://build.qorechain.io/badge/paper-trail.svg)](https://build.qorechain.io/p/paper-trail)

A post-quantum chain of custody for exam papers, built on QoreChain testnet
(`qorechain-diana`) for the QoreChain Developer Fest, Encrypted Apps (QoreSeal)
category.

> Work in progress. The full design is in [`docs/SPEC.md`](docs/SPEC.md);
> platform findings are in [`docs/findings.md`](docs/findings.md).

## Live deployment (qorechain-diana testnet)

- **Web app:** https://paper-trail-web-nu.vercel.app (judge mode: "Start the 3-minute demo").
- **API:** https://paper-trail-api.vercel.app ([`/health`](https://paper-trail-api.vercel.app/health)); judge mode: `POST /demo/start`.
- **Before judging:** see the [pre-judging checklist](docs/PRE_JUDGING.md) (relayer funds, EVM window, live checks).
- **PaperTrail v2 contract:** `0xbe6b208Bc8990a68740053Dad68624914812cf8F`

### Project-page addresses (max 5, read on chain)

| Role | qor1 | 0x |
|---|---|---|
| PaperTrail v2 contract | `qor1he4jpz7gny9xsaqq20dddp3yj9yp9nu0pxscg9` | `0xbe6b208Bc8990a68740053Dad68624914812cf8F` |
| Relayer (EVM window, all EVM txs) | `qor12hsns22892r494chkmltpqkn3v7uve3nkej5k0` | `0x55E13829472A8752d717B6feB082d38B3DC66633` |
| Board | `qor1z4hxgg20j88q9x2exfgp8u3zduy45yum60fja3` | `0x156e64214f91CE029959325013f2226f095A139B` |
| Examiner 1 | `qor1fu27dps85sltca52uvwx42gu63wp39jvtn36ny` | `0x4f15E68607A43Ebc768AE31c6aA91Cd45C18964C` |
| Examiner 2 | `qor1xjk8t2zzvrh07yptxfju8w3zgw954vp3ezm47c` | `0x34ac75a84260eefF102B3265C3bA22438b4ab031` |

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Foundry project for `PaperTrail.sol` (EVM lane, chain 9800) |
| `packages/core` | Isomorphic crypto core (sealing, splitting, canary copies, signed actions) |
| `packages/shared` | Zod schemas, types and error codes shared by the API and web app |
| `apps/api` | NestJS + Prisma API and relayer |
| `apps/web` | Vite + React web app: judge mode, audit trail, exam page, verify-a-paper and check-my-mark |
| `scripts/` | Account setup, registration and platform-finding scripts |

## Getting started

```sh
pnpm install
cp .env.example .env      # fill in locally; never commit it
pnpm -r build && pnpm -r test
(cd packages/contracts && forge test)
```

## Web app (`apps/web`)

```sh
pnpm --filter @paper-trail/core build && pnpm --filter @paper-trail/shared build
pnpm --filter web dev        # http://localhost:5173, against the deployed API
```

Deployed as a static build: `pnpm --filter web build`, then `vercel deploy --prod` of `apps/web/dist`
with `apps/web/vercel.json` (the SPA rewrite) to the `paper-trail-web` Vercel project.

Configuration is in `apps/web/.env.example` (`VITE_API_URL` and the chain endpoints); copy it
to `apps/web/.env.local` to override. The API only accepts browser calls from origins listed in
its `CORS_ORIGIN`.

| Route | What |
|---|---|
| `/` | Landing page; "Start the 3-minute demo" calls `POST /demo/start` |
| `/demo/:demoId` | Judge mode: the 7 beats, driven by `/demo/*`, restored from the server's step log on reload |
| `/try` | Try the encryption, in your browser (`@paper-trail/core` in a Web Worker): seal a message to any registered `qor1` address, make and register your own key, and open messages sealed to it |
| `/exams/:examId/audit` | Live audit trail of on-chain events, with the commitments to check against |
| `/exams/:examId` | Exam status, centres, epochs and release counts |
| `/verify` | Hash a paper in the browser and compare with the API and `commitment(examId, centreId)` on-chain |
| `/marks` | Verify a mark's Merkle proof in the browser against the `MarksPublished` root |

## Credits

Kits, templates and libraries used (required by the Fest rules):

- [`create-qorechain-dapp`](https://www.npmjs.com/package/create-qorechain-dapp)
  — `foundry` template (testnet), which `packages/contracts` was generated from,
  including its EVM-window helper `scripts/window.ts`
- [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk) — native-lane
  client, PQC key registration, account derivation
- [`@qorechain/qoresign`](https://www.npmjs.com/package/@qorechain/qoresign) — classical + canonical ML-DSA-87 key derivation, hybrid signing, SIWQ
- [`@qorechain/evm`](https://www.npmjs.com/package/@qorechain/evm) — PQC
  precompile ABIs and EVM authorisation window helpers
- [Foundry](https://getfoundry.sh) and [`forge-std`](https://github.com/foundry-rs/forge-std)
- [NestJS](https://nestjs.com) (generated with `@nestjs/cli`), [Prisma](https://www.prisma.io)
  with `@prisma/adapter-pg`, [jose](https://github.com/panva/jose) (session JWTs),
  `cookie-parser`, [supertest](https://github.com/ladjs/supertest)
- [`@qorechain/qoresign`](https://www.npmjs.com/package/@qorechain/qoresign), [`@qorechain/qoreseal`](https://www.npmjs.com/package/@qorechain/qoreseal),
  [`@qorechain/pqc`](https://www.npmjs.com/package/@qorechain/pqc) — role keys, SIWQ, sealing, epoch groups, SHAKE256
- [`@noble/hashes`](https://github.com/paulmillr/noble-hashes), [`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers),
  [`@scure/bip39`](https://github.com/paulmillr/scure-bip39),
  [`shamir-secret-sharing`](https://github.com/privy-io/shamir-secret-sharing) (Privy)
- Web app: [`@qorechain/react`](https://www.npmjs.com/package/@qorechain/react) (`PqcStatusBadge`, `QoreChainProvider`),
  [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk) (the badge's client),
  [`@qorechain/qorex-types`](https://www.npmjs.com/package/@qorechain/qorex-types), [React](https://react.dev),
  [React Router](https://reactrouter.com), [Vite](https://vite.dev), [viem](https://viem.sh) (direct contract reads),
  [react-markdown](https://github.com/remarkjs/react-markdown), [Tabler Icons](https://tabler.io/icons) (MIT),
  [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) and
  [JetBrains Mono](https://www.jetbrains.com/lp/mono/) and [Caveat](https://fonts.google.com/specimen/Caveat) (SIL OFL), [Testing Library](https://testing-library.com)
- [tsup](https://tsup.egoist.dev), [Vitest](https://vitest.dev), [jsdom](https://github.com/jsdom/jsdom),
  [Zod](https://zod.dev), [viem](https://viem.sh)

## Encrypted Apps requirements

How Paper Trail meets the Encrypted Apps (QoreSeal) requirements, with the code that does it. All
cryptography lives in [`packages/core`](packages/core), the **client** library: it wraps the official
QoreChain kits and never needs a server to encrypt, decrypt or sign.

| Requirement | Where | What it does |
|---|---|---|
| **ML-KEM-1024 encryption (QoreSeal)** | [`split.ts` `setExam`](packages/core/src/split.ts#L64) | Encrypts each centre's copy with AES-256-GCM under a fresh key, splits that key 2-of-3 and seals each share to one examiner, and seals the committee bundle to the examiners and the board (QoreSeal: ML-KEM-1024 + X25519). |
| | [`groups.ts` `BoardGroups`](packages/core/src/groups.ts#L49), [`openGroupEpoch`](packages/core/src/groups.ts#L149) | Centre and marker teams are QoreSeal epoch groups: every membership change seals a fresh epoch key to the current members only. |
| | [`release.ts` `prepareRelease`](packages/core/src/release.ts#L42), [`openPaper`](packages/core/src/release.ts#L80), [`sealedToExactly`](packages/core/src/release.ts#L67) | An examiner re-seals their share to the centre's current invigilators; an invigilator opens the paper and checks it against the on-chain commitment. |
| | [`scripts.ts` `sealScript` / `openScript`](packages/core/src/scripts.ts#L24) | Answer scripts are sealed to the markers under a pseudonym. |
| **Registered PQC keys** | [`register.ts` `ensureRoleOnChain`](packages/core/src/register.ts#L65), [`roleStatus`](packages/core/src/register.ts#L43), [`scripts/register.ts`](scripts/register.ts) | Registers each role's ML-DSA-87 key (QoreChain PQC registry) and ML-KEM-1024 key (KEM registry) on qorechain-diana; idempotent. |
| **ML-DSA-87 binding** | [`register.ts` `recipientCardFor`](packages/core/src/register.ts#L56), [`verify.ts` `resolveGroupRecipients`](packages/core/src/verify.ts#L38) | Each role publishes a recipient card signed with its ML-DSA-87 (and classical) key. Before sealing anything, a client checks every recipient's card against the keys registered **on chain** (pqcKeyStatus precompile and the KEM registry) and the member list against the board-signed `EpochChanged` event, so the API can't slip in its own key. |
| | [`actions.ts` `signAction`](packages/core/src/actions.ts#L92), [`PaperTrail.sol`](packages/contracts/src/PaperTrail.sol#L281) | Every action (create, set centre, rotate team, release, submit script, publish marks) is signed with ML-DSA-87 by the role key and verified on chain by the `pqcVerify` precompile; the relayer can't forge one. |
| | [`binding.ts`](packages/core/src/binding.ts#L16), [`PaperTrail.sol` `bindIdentity`](packages/contracts/src/PaperTrail.sol#L264) | Optional binding of a role key to the user's QoreX wallet address, signed with ML-DSA-87 and recorded on chain. |
| **Client-side encryption and decryption** | [`packages/core`](packages/core/src/index.ts) | The client library: key creation and passphrase storage ([`keys.ts`](packages/core/src/keys.ts#L45)), sealing, opening and signing all run where the role key is. |
| | [`/try` page](https://paper-trail-web-nu.vercel.app/try), [`crypto.worker.ts`](apps/web/src/workers/crypto.worker.ts), [`messages.ts`](packages/core/src/messages.ts) | **Seal to any registered QoreChain address:** the browser reads each `qor1` address's ML-KEM-1024 key from the chain's KEM registry and, when a recipient card is published, checks the card against the address's ML-DSA-87 key (`pqcKeyStatus`); then it seals (hybrid ML-KEM-1024 + X25519, or ML-KEM-1024 alone without a card) and hands back a `.ptseal` file. An address with no registered key is refused. The message never leaves the browser. |
| | [`/try` page](https://paper-trail-web-nu.vercel.app/try), [`keys.ts` `encryptRoleKey`](packages/core/src/keys.ts#L74), [`register.ts` `ensureRoleOnChain`](packages/core/src/register.ts#L65) | **Decrypt with your own registered key:** the browser makes a role key, keeps it only as an Argon2id + AES-256-GCM blob in `localStorage`, registers its ML-DSA-87 and ML-KEM-1024 keys on chain (signed in the browser; see the relay note below), and opens messages sealed to its address. Any other key gets `NOT_A_RECIPIENT`. Checked live: a key registered from one browser opened a message another browser sealed to its address. |
| | [`chain-relay.controller.ts`](apps/api/src/chain-relay/chain-relay.controller.ts) | QoreChain's REST and Tendermint RPC endpoints send no CORS headers, so the API relays the browser's registration: allowlisted reads and already-signed transactions, forwarded unchanged and rate-limited. It holds no keys and can't alter a signed transaction. Chain reads for sealing go straight from the browser to the EVM JSON-RPC (`qor_getKEMKey`, `qor_getPQCKeyStatus`), which allows browsers. |
| | [`demo.service.ts`](apps/api/src/demo/demo.service.ts#L313) | **Honest note:** in judge mode the server holds the DEMO role keys and runs this same client code (`openPaper`, `sealScript`, …) on their behalf, so a judge needs no wallet. Real users would run it in their own browser; the multi-role web UI for that (P2) is not built. |

**Tests and runs that exercise the client code on its own**

- [`packages/core/test`](packages/core/test): unit tests for sealing and opening ([`groups`](packages/core/test/groups.test.ts), [`scripts`](packages/core/test/scripts.test.ts), [`split`](packages/core/test/split.test.ts), [`keys`](packages/core/test/keys.test.ts), [`register`](packages/core/test/register.test.ts)) and a whole exam ([`flow`](packages/core/test/flow.test.ts)); `pnpm --filter @paper-trail/core test`.
- [`verify-live.test.ts`](packages/core/test/verify-live.test.ts) (`LIVE=1`): `resolveGroupRecipients` against a real demo exam's markers on qorechain-diana, reading KEM keys the way a browser must.
- [`apps/web/test/sealLab.test.ts`](apps/web/test/sealLab.test.ts): the `/try` quick lab with real core crypto (only chosen keys open; a stranger gets `NOT_A_RECIPIENT`).
- [`packages/core/test/messages.test.ts`](packages/core/test/messages.test.ts): sealing to addresses with real crypto (hybrid with a verified card, ML-KEM-1024 without one, an unregistered address refused, an edited recipient list won't open); [`messages-live.test.ts`](packages/core/test/messages-live.test.ts) (`LIVE=1`) seals to Marker 1's real registered address.
- [`apps/api/src/chain-relay.spec.ts`](apps/api/src/chain-relay.spec.ts): the relay forwards only allowlisted reads and methods, byte for byte, and rate-limits broadcasts.
- [`scripts/full-e2e.ts`](scripts/full-e2e.ts) (`pnpm full:e2e`): every role as a separate core client with its own registered keys, a full exam on qorechain-diana through the API. The recorded passing run ([`scripts/out/full-e2e.json`](scripts/out/full-e2e.json)) used a locally run API against the live chain.
- [`scripts/demo-e2e.ts`](scripts/demo-e2e.ts): judge mode against the deployed API ([`scripts/out/demo-e2e-deployed.json`](scripts/out/demo-e2e-deployed.json)).

**What this does not claim.** The server is not trustless: it relays transactions, hosts ciphertext,
and in judge mode holds the demo keys. It can't read papers or forge actions for real users, because
those keys never reach it and every action is checked on chain. QoreSeal is version 0.1.0, pending
external review; testnet only. See the trust model below.

## Trust model (honest version)

- **The API and the relayer are untrusted for integrity.** Every action is signed with ML-DSA-87 by the role
  holder and checked on chain (`pqcKeyStatus` + `pqcVerify`). Clients verify group recipients against the
  chain (`resolveGroupRecipients`), not against the API's word. The server stores only ciphertexts,
  envelopes and hashes.
- **Two examiners are needed to release a centre's paper**, at or after the start time, sealed to that
  centre's *current* invigilators. A removed invigilator cannot open anything released after the removal.
  The released epoch is signed and checked on chain.
- **The board operates the epoch groups**, so it can read what is sealed to them. It never holds two shares
  unless two examiners release.
- **Canary attribution protects the distribution chain, not the committee.** The committee bundle (exam
  secret, paper, fingerprint tables) is sealed to the 3 examiners and the board, so any one of them could
  render any centre's copy and leak it, framing that centre. A leaked copy that names a centre therefore
  points at that centre *or* the committee. The master copy has its own fingerprint.
- **The API also relays key registration for browsers** (`/chain/*`), because QoreChain's native endpoints block browsers. It forwards only allowlisted reads and transactions the browser has already signed; it can't change them or register anything on its own.
- **Liveness depends on the relayer;** if it is down, nothing is lost. A release relayed by someone else
  lands on chain, but `/released` can only serve blobs that reached the API.
- **Metadata is public on chain** (who, when, sizes); only payloads are confidential. QoreSeal is 0.1.0,
  pending external review.

## Licence

[Apache-2.0](LICENSE)
