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
- [NestJS](https://nestjs.com) (generated with `@nestjs/cli`) and
  [Prisma](https://www.prisma.io)
- [tsup](https://tsup.egoist.dev), [Vitest](https://vitest.dev),
  [Zod](https://zod.dev), [viem](https://viem.sh)

## Licence

[Apache-2.0](LICENSE)
