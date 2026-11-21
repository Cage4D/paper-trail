# Paper Trail

[![Built on QoreChain](https://build.qorechain.io/badge/paper-trail.svg)](https://build.qorechain.io/p/paper-trail)

A post-quantum chain of custody for exam papers, built on QoreChain testnet
(`qorechain-diana`) for the QoreChain Developer Fest, Encrypted Apps (QoreSeal)
category.

> Work in progress. The full design is in [`docs/SPEC.md`](docs/SPEC.md);
> platform findings are in [`docs/findings.md`](docs/findings.md).

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Foundry project for `PaperTrail.sol` (EVM lane, chain 9800) |
| `packages/core` | Isomorphic crypto core (sealing, splitting, canary copies, signed actions) |
| `packages/shared` | Zod schemas, types and error codes shared by the API and web app |
| `apps/api` | NestJS + Prisma API and relayer |
| `scripts/` | Account setup, registration and platform-finding scripts |

## Getting started

```sh
pnpm install
cp .env.example .env      # fill in locally; never commit it
pnpm -r build && pnpm -r test
(cd packages/contracts && forge test)
```

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
