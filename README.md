# Paper Trail

[![Built on QoreChain](https://build.qorechain.io/badge/paper-trail.svg)](https://build.qorechain.io/p/paper-trail)

A post-quantum chain of custody for exam papers, built on QoreChain testnet
(`qorechain-diana`) for the QoreChain Developer Fest, Encrypted Apps (QoreSeal)
category.

> Work in progress. The full design is in [`docs/SPEC.md`](docs/SPEC.md);
> platform findings are in [`docs/findings.md`](docs/findings.md).

## Live deployment (qorechain-diana testnet)

- **API:** https://paper-trail-api.vercel.app ([`/health`](https://paper-trail-api.vercel.app/health)); judge mode: `POST /demo/start`.
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

Configuration is in `apps/web/.env.example` (`VITE_API_URL` and the chain endpoints); copy it
to `apps/web/.env.local` to override. The API only accepts browser calls from origins listed in
its `CORS_ORIGIN`.

| Route | What |
|---|---|
| `/` | Landing page; "Start the 3-minute demo" calls `POST /demo/start` |
| `/demo/:demoId` | Judge mode: the 7 beats, driven by `/demo/*`, restored from the server's step log on reload |
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
  [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (SIL OFL), [Testing Library](https://testing-library.com)
- [tsup](https://tsup.egoist.dev), [Vitest](https://vitest.dev), [jsdom](https://github.com/jsdom/jsdom),
  [Zod](https://zod.dev), [viem](https://viem.sh)

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
- **Liveness depends on the relayer;** if it is down, nothing is lost. A release relayed by someone else
  lands on chain, but `/released` can only serve blobs that reached the API.
- **Metadata is public on chain** (who, when, sizes); only payloads are confidential. QoreSeal is 0.1.0,
  pending external review.

## Licence

[Apache-2.0](LICENSE)
