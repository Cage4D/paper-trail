## Phase 0 complete — Verify & set up

### What was built
- **pnpm monorepo** (`packages/*`, `apps/*`):
  - `packages/contracts` from the official `create-qorechain-dapp` foundry template (testnet), untouched;
  - empty `packages/core` and `packages/shared` (TypeScript, tsup, Vitest);
  - `apps/api` (NestJS 12 + Prisma 7);
  - each with a passing placeholder test.
- Root files: Apache-2.0 `LICENSE`, `.gitignore` (covers `.env` and `.pgdata/`), `.env.example`, and a README with the Built-on-QoreChain badge and a Credits section.
- **10 testnet role accounts.** Mnemonics are only in `.env`. Four (relayer, board, examiner1, examiner2) are funded with 10 QOR each and have **PQC (ML-DSA-87) and KEM (ML-KEM-1024) keys registered**.
- **The relayer's EVM window is open**, using the template's `scripts/window.ts`.
- **All of §13 is answered with evidence in `docs/findings.md`** except Q10. Decisions D1–D3 are recorded there.
- A throwaway local Postgres 18 on `127.0.0.1:54329` (`.pgdata/`, ignored by git). Production uses the Vercel-managed DB.

### Files added / changed (path — purpose)
- `pnpm-workspace.yaml`, `package.json` — workspace, script entry points, pnpm 12 build approvals (esbuild, Prisma engines)
- `LICENSE`, `README.md`, `.gitignore`, `.env.example` — licence, badge and credits, secret hygiene, config template
- `packages/contracts/**` — the official Foundry template (Counter, tests, `scripts/window.ts`), forge-std vendored
- `packages/core/**`, `packages/shared/**` — empty libraries with placeholder tests
- `apps/api/**` — Nest CLI app, `prisma/schema.prisma` (no models yet), `prisma7.config.ts` reading the root `.env`
- `scripts/lib/env.ts` — loads the root `.env` and derives role accounts (never prints secrets)
- `scripts/accounts.ts` — generates missing mnemonics into `.env`, prints addresses, cross-checks SDK vs QoreSign derivation
- `scripts/register.ts` — idempotent PQC (`ensurePqcRegistered`) and KEM (`MsgRegisterKEMKey`) registration
- `scripts/out/registrations.json` — registration tx hashes and costs (public data)
- `scripts/findings/q1-q3-pqcverify.ts` — `pqcVerify` input sizes, gas, context, and raw vs pre-hash, on diana
- `scripts/findings/q3-keystatus.ts` — `pqcKeyStatus` via the EVM precompile, live KEM keys, window status
- `scripts/findings/q7-epoch-restore.ts` — `EpochKeyManager` restore across processes
- `scripts/findings/q8-shamir.test.ts`, `vitest.q8.config.ts` — Shamir under Node vs jsdom
- `scripts/findings/out/*` — raw outputs of the scripts above
- `docs/findings.md` — the answers, decisions D1–D3, and the 5-address submission plan

### How to check it yourself (copy-paste commands + what you should see)
```bash
pnpm install && pnpm -r build && pnpm -r test
```
Expected: contracts 3/3, core 1/1, shared 1/1, api 1/1.
```bash
(cd packages/contracts && forge test)
```
Expected: `3 tests passed`.
```bash
pnpm register --status
```
Expected: all four accounts show `pqc: registered (this key)`, `pqcAlgorithmId: 1`, `kem: registered (this key)`. Nothing is sent.
```bash
pnpm findings:q1q3
```
Expected: `valid: true` only for pure ML-DSA-87 with an empty context over the exact signed bytes; estimateGas is about 312k.
```bash
curl -s https://api-testnet.qore.host/qorechain/pqc/v1/kem/qor12hsns22892r494chkmltpqkn3v7uve3nkej5k0
```
Expected: the relayer's registered ML-KEM key.
```bash
curl -s https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/38113D93AC2FBB166298F1C6FA648998A06386F762FC279C06ECBCFB28F6699E | head -c 400
```
Expected: the window-opening transaction.

### Results (tests X/Y; diana txids with explorer links)
- Tests: 6/6 (contracts 3, core 1, shared 1, api 1). Q7 and Q8 checks pass.
- Explorer links: none. `@qorechain/sdk` has no testnet explorer configured, so the transactions below are listed by hash. Verify them with `/cosmos/tx/v1beta1/txs/<hash>`.

| Account | PQC registration | KEM registration (`MsgRegisterKEMKey`) |
|---|---|---|
| relayer `qor12hsns22892r494chkmltpqkn3v7uve3nkej5k0` | `DECB64DA1DB0B9A96A08619285205C31DCDB49BA251EE7E7B1E230C446A82C44` | `A4224E3CEEF4FA144AC3D1169FF27D2A7FDAD4D19A42D4508E6094DC45008FFE` |
| board `qor1z4hxgg20j88q9x2exfgp8u3zduy45yum60fja3` | `26016DB2C72B11F37014DB1E586D0FB09DD42F695478A4A402CB7EBF8B9A8E64` | `630907BD77213B9BF1D667325132E7982D18FBD3B3D1B707192C82D7D0D2401C` |
| examiner1 `qor1fu27dps85sltca52uvwx42gu63wp39jvtn36ny` | `E3229EEFA7FE1EA66D77E44C800CE2F041C5C4340AB916C6C8BF413EF1973748` | `B9A0CB4C81B44DF28D579FF03F929303ED1556ED2AE49D7D5AA4E5E2F29109EC` |
| examiner2 `qor1xjk8t2zzvrh07yptxfju8w3zgw954vp3ezm47c` | `AB89F6634EF832E337D7CE22073968AC7F38516BE43F679E9F2A683A603679F9` | `652ACF58A8795229D544BB26FB7B5B6F119B421A4732CBA861515A519AA2383F` |

- **Relayer EVM window:** tx `38113D93AC2FBB166298F1C6FA648998A06386F762FC279C06ECBCFB28F6699E`. It allows 17,280 blocks, 20 txs and a 5 QOR cap, opened at height 10,431,330 and expiring at 10,448,610 (about 6.9 h).
- **On-chain `pqcKeyStatus`:** returns `(true, 1, 2,592-byte key)` for all four accounts, and each key equals the locally derived one.
- **Costs:** every registration and the window opening cost 0.1 QOR, the fee only. Balances are now 9.8 QOR for board, examiner1 and examiner2, and 9.7 QOR for the relayer.

### Deviations from the spec (or "none")
1. **pnpm 12 build approvals.** The scaffolder's install failed with `ERR_PNPM_IGNORED_BUILDS` (esbuild). esbuild and Prisma's engines were approved with `pnpm approve-builds`, and the template files are unchanged.
2. **Generator noise removed.** `prisma init` added third-party AI-agent skill folders, which I deleted. Nest's paid "Mau" deploy script was also dropped.
3. **Precompile address literals.** The literals in §5 (`0x…0A01` / `0x…0A02`) fail `solc` (error 9429, invalid checksum). Phase 1 will use the checksummed `0x…0a01` / `0x…0a02`, which are the same addresses.
4. **Agreed decisions D1–D3**, recorded in findings:
   - D1: auth stays as specified.
   - D2: SIWQ is signed by the role key, and QoreX is bound through a `signAndBroadcast` transaction, because QoreX 0.3.x has no message signing.
   - D3: the API runs serverless on Vercel, with indexing on read plus cron, lazy window reopen and polling instead of SSE.
5. **QoreSeal context format (§4.2).** QoreSeal purposes and contexts must match `[A-Za-z0-9._:/-]{1,128}`. `examId‖centreId` needs a new encoding, which I'll propose in Phase 3.
6. **Window helper flags.** `scripts/window.ts` was run with the relayer mnemonic injected from the root `.env` (`QORE_MNEMONIC`) instead of a separate `packages/contracts/.env`, so the mnemonic exists in only one file.

### Decisions I need from you (or "none")
1. **examiner3 must be registered before Phase 2.** `createExam` requires 3 registered examiners. Please send examiner3 (`qor1d6lq980c4da0szehzeqezevtz8f7xm5qh935tq`) about 1 QOR from a funded account, or claim from the faucet tomorrow. I'll then run `pnpm register examiner3`.
2. **Explorer URL:** which block explorer should the reports and the README link to for diana? The SDK doesn't configure one.

### Known issues / TODOs carried forward
- Q10 (Encrypted Apps rubric): needs someone to ask in Discord.
- Still unfunded: examiner3, invigilatorA1, invigilatorA2, invigilatorB1, marker1, marker2. They need funding and registration before Phase 6.
- The relayer window expires about 6.9 h after opening. Phase 2 opens a fresh one, restricted to the PaperTrail contract with `allowedTargets`, before deploying.
- The gas of `pqcVerify` when called from a contract, and the real gas per action, are measured in Phase 2.
- Vercel Cron limits on Hobby, and NestJS-on-Vercel packaging, are checked before Phase 4.
- Node on WSL needs `--no-network-family-autoselection`. It's already set in the `pnpm` scripts that use the network.

### Next: Phase 1 — Contract
Write `PaperTrail.sol` as in §5, using the checksummed precompile addresses and `ML_DSA_87 = 1`. `_auth` does:
1. a `pqcKeyStatus` gate on the signer;
2. a domain-separated `keccak256` digest with a per-signer nonce;
3. `pqcVerify(pk, sig, abi.encodePacked(digest))` (pure ML-DSA-87, empty context, raw 32-byte message, as Q3 established).

The precompiles are mocked with `vm.etch` plus a test key table so all 15 cases of §5.1 run offline. A shared digest test-vector file feeds the Phase 3 TypeScript tests, and the README documents each function. No deployment until Phase 2.

Reply "proceed" to continue.
