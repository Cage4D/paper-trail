# Phase 0 findings (spec §13)

Network: `qorechain-diana`, EVM chain id 9800. EVM RPC `https://evm-testnet.qore.host`,
REST `https://api-testnet.qore.host`. Kit versions: `@qorechain/sdk` 0.14.0, `@qorechain/evm`
0.14.0, `@qorechain/qoresign` 0.2.0, `@qorechain/qoreseal` 0.1.0, `@qorechain/pqc` 0.2.3
(wraps `@noble/post-quantum` 0.7.1).

Every claim below cites a script in `scripts/findings/` (raw output in
`scripts/findings/out/`) or a package source location.

## Decisions (agreed 2026-11-20)

| # | Decision | Replaces |
|---|---|---|
| D1 | **Auth stays signature-authorised** (§3.1). Role-key ML-DSA-87 signatures are checked on-chain by `pqcKeyStatus` + `pqcVerify` and submitted by an untrusted relayer. The `msg.sender` fallback is not needed (Q1). Final confirmation is the Phase 2 live call from a contract. | — |
| D2 | **SIWQ is signed by the app role key** (`signSiwq` with classical + ML-DSA-87, verified with `verifySiwqWithChain`). QoreX only supplies the user's `qor1` address. **The QoreX binding is a one-time `signAndBroadcast` self-transfer of 1 uqor with the API nonce in the memo**, behind a feature flag. A QoreX `signArbitrary` path is added later if QoreX ships it (testable with the mock's `"planned"` profile). | §3.2 "users sign in with QoreX (SIWQ)" and the SIWQ-signed bind statement; §7.3 `/auth/siwq/*` and `/me/role` bodies |
| D3 | **The API runs on Vercel (serverless)** with the Vercel-managed Postgres. The indexer catches up on read (`eth_getLogs` from the last indexed block) plus a Vercel Cron job. The EVM window is checked and reopened lazily before each relay, under a Postgres advisory lock. **Polling replaces SSE.** No uptime ping. | §7.1 ChainModule indexer and RelayerModule auto-reopen; §7.3 SSE; §9 hosting and uptime ping |

| # | Question | Status |
|---|---|---|
| Q1 | `pqcVerify` takes ML-DSA-87 sizes? gas? | **Answered** |
| Q2 | QoreX raw ML-DSA / SIWQ signing | **Answered: no, not in QoreX 0.3.x.** Needs a decision (§3.2, §7.3) |
| Q3 | context string, algorithmId, raw vs pre-hash | **Answered** (algorithmId on-chain read pending a registered account) |
| Q4 | derivation works with registration? fees? | derivation **answered**; fees pending funding |
| Q5 | EVM window limits, cost, unattended reopen | limits **answered**; cost pending funding |
| Q6 | `sealToAddresses` resolves KEM key + card? | **Answered**: KEM key on-chain, card app-hosted |
| Q7 | `EpochKeyManager` history restore | **Answered**: works across processes |
| Q8 | `shamir-secret-sharing` Node = browser | **Answered**: identical given equal randomness; shares interoperate |
| Q9 | free always-on API host | **Answered with a constraint**: Vercel can't run long-lived processes. Needs a decision |
| Q10 | Encrypted Apps rubric | pending (ask in Discord) |

---

## Q1. Does `pqcVerify` accept ML-DSA-87 sizes, and what does it cost?

**Yes.** Script: `scripts/findings/q1-q3-pqcverify.ts` → `out/q1-q3.json` (run 2026-11-20,
`eth_call` + `eth_estimateGas` directly to `0x…0a01`, from an unfunded address).

- A real ML-DSA-87 key (2,592 B) and signature (4,627 B) over a 32-byte digest returns
  `true` (ABI-encoded calldata: 7,460 B). Tampered signature, wrong key and wrong message
  each return `false` (they do not revert).
- **Input cap.** `GET /qorechain/pqc/v1/evm_limits` (`fetchEvmLimits`) reports
  `precompile_input_max_bytes = 16384` and `tx_max_gas = 30,000,000`. Our calldata
  (7,460 B) is well below the cap. The size sweep went up to a 16 KiB message (23,812 B of
  calldata) and still verified `true`. The SDK describes the cap as applying to
  *"guarded stateful precompiles"* (`sdk/dist/index.d.ts`, `EvmLimits`), so it does not
  appear to bind on `pqcVerify`. Either way the spec's input is under it.
- **Gas** (`eth_estimateGas` of a top-level call, so it includes the 21,000 base and calldata):

  | message | calldata | estimateGas |
  |---|---|---|
  | 32 B (our digest) | 7,460 B | **312,380** |
  | 300 B | 7,748 B | 322,760 |
  | 1 KiB | 8,452 B | 351,880 |
  | 4 KiB | 11,524 B | 474,730 |
  | 16 KiB | 23,812 B | 964,030 |

  The intrinsic cost of the 32-byte case is 137,552 (21,000 + 16 per non-zero / 4 per zero
  calldata byte), so **the precompile itself costs about 175,000 gas per verification**,
  plus roughly 24 gas per extra message byte. Since we always pass a 32-byte digest, it is
  about 175k flat.
- **Estimate for one PaperTrail action**, to be confirmed in Phase 2: 21k base + about 78k
  calldata (4.6 KB signature + args) + `pqcKeyStatus` (returns the 2.6 KB key; cost
  measured in Phase 2) + about 175k verify + storage. That comes to **about
  350–450k gas, about 0.04–0.05 QOR at 112.5 gwei**, well under the 30M cap.

### Recommendation on §3.1: keep the signature-authorised contract with an untrusted relayer

The fallback condition in §3.1 ("`pqcVerify` refuses ML-DSA-87-sized input because of
`precompileInputMaxBytes` or gas") **does not occur**. The input fits, the result is a clean
`bool`, and the gas is moderate. I recommend building `PaperTrail.sol` as specified:
ML-DSA-87 signatures by role holders, checked with `pqcKeyStatus` and `pqcVerify`,
submitted by one relayer.

Two things are still open and are checked in the Phase 2 live smoke test:

1. **The call from inside a contract** (a `STATICCALL` from Solidity) has not been tried
   yet. Today's evidence is a top-level `eth_call`.
2. **The real gas per action,** including the `pqcKeyStatus` read.

---

## Q3. Signature context, algorithmId, raw vs pre-hashed message

Same script and run as Q1. Every signature below was checked against a 32-byte digest
unless stated.

| Signed as | `pqcVerify` |
|---|---|
| Pure ML-DSA-87 (FIPS 204), **empty context**, deterministic (`qoresign.pqSign`, the kit default) | **true** |
| Pure ML-DSA-87, empty context, hedged (randomised) | **true** |
| Pure ML-DSA-87, context `"PaperTrail.v1"` | false |
| HashML-DSA (SHA-512 pre-hash), empty context | false |
| 300-byte message signed raw, precompile given the raw message | **true** |
| 300-byte message signed raw, precompile given `keccak256(message)` | false |
| `keccak256(message)` signed, precompile given the raw message | false |

What this shows:

- **Context:** the precompile verifies **pure ML-DSA-87 with an empty context string**,
  which is FIPS 204 `ML-DSA.Verify` with `ctx = ""`. A non-empty context, or HashML-DSA,
  fails. Spec §4.4 stays as written: sign the 32-byte digest with an empty context. In
  code that means `pqSign(secretKey, digest)` from `@qorechain/qoresign`, or
  `pqcSign` from `@qorechain/sdk`. Both wrap `@qorechain/pqc` `mldsa87.sign`, which calls
  noble's `ml_dsa87.sign(msg, sk, { extraEntropy: false })` with the default empty context
  (`@qorechain/pqc/src/index.js`, `wrapSig`).
- **Raw vs pre-hash:** the precompile verifies the `message` bytes **as given**; it does
  not hash them first. The contract must pass exactly the bytes that were signed, so
  `abi.encodePacked(digest)` (32 bytes) as in the §5 sketch.
- Deterministic and hedged signatures are both accepted, which matches the
  `@qorechain/pqc` docs.
- **algorithmId:** `@qorechain/qoresign` exports `ALGORITHM_ML_DSA_87 = 1`
  (`message-*.d.ts`, line 9). `@qorechain/sdk` has `AlgorithmDilithium5 = 1` and
  `AlgorithmMLKEM1024 = 2` (`sdk/dist/index.js`, line 18394). So
  **`ML_DSA_87 = 1`** for the contract constant. *Still to do:* read
  `pqcKeyStatus(relayer)` on-chain once the relayer has registered its key, and confirm it
  returns `1`.

### Two related issues found

- **Address checksum (affects the §5 sketch).** `solc` 0.8.28 rejects the literal
  `0x0000000000000000000000000000000000000A01` with error 9429: *"This looks like an
  address but has an invalid checksum. Correct checksummed address:
  0x0000000000000000000000000000000000000a01"*. The checksummed literals are
  `0x…0a01` and `0x…0a02`. `@qorechain/evm`'s `PRECOMPILE_ADDRESSES` has the same
  upper-case form, and viem's strict check rejects it ("Address … is invalid"). In
  TypeScript, wrap it in `getAddress()`. Phase 1 will use the checksummed literals. That
  is a one-character change from the spec sketch, with the same address.
- **Node networking (WSL).** Node can stall on the endpoints' IPv6 records, failing with
  `ENETUNREACH` and then an IPv4 timeout. Running with
  `NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first"`
  worked reliably. The default happy-eyeballs attempt timeout of 250 ms is too short over WSL; `curl` reaches both
  IPv4 addresses in about 1.2–1.4 s.

---

## Q4. Derivation with `deriveClassicalKey` + `deriveCanonicalPqKey` (partial)

`scripts/accounts.ts` derives every role account two ways and compares them:

- **SDK:** `@qorechain/sdk` `deriveUnifiedAccount(mnemonic, 0)`, which uses secp256k1 at
  `m/44'/60'/0'/0/0` plus `SHAKE256("qorechain:pqc:v1|" + qor1addr + "|" + mnemonic)`.
  This is also what the template's `scripts/window.ts` uses with `QORE_MNEMONIC`.
- **QoreSign:** `@qorechain/qoresign` `deriveClassicalKey({ type: "eth_secp256k1" })` +
  `addressFromPublicKey` + `deriveCanonicalPqKey({ mnemonic, address })`.

**All 10 accounts match exactly** (same `qor1…`/`0x…` address and the same 2,592-byte
ML-DSA-87 public key). The role keys of §3.2 are therefore the same keys the SDK registers
and the window helper signs with. *Still to do:* registration fees for PQC and KEM keys,
measured when the accounts are funded and registered.

---

## Q2. Can QoreX sign raw ML-DSA messages or SIWQ for us?

**No, not with QoreX 0.3.x**, the current build. Sources are `@qorechain/qorex-types` 0.1.0
(`dist/index.d.ts` and its README) and `@qorechain/qorex-wallet-mock` 0.1.0, whose
`profile: "current"` mirrors today's wallet.

- **EVM provider (`window.qorex.evm`):** answers only `eth_chainId`, `eth_accounts`,
  `eth_requestAccounts` and `wallet_switchEthereumChain`. `personal_sign`,
  `eth_signTypedData_v4` and `eth_sendTransaction` reject with
  *"QoreX: EVM method <name> not yet supported"*.
- **Native provider (`window.qorex.native`):**
  - `signArbitrary` (ADR-36) is *"Present but refused in current builds"* and rejects
    with *"QoreX: signArbitrary not yet supported"* before any prompt. The mock does the
    same unless `profile: "planned"`.
  - `connectProof` (the pairing proof) is *"Dashboard only: accepted from
    https://dashboard.qorechain.io and refused for every other origin"*.
  - What remains for a third-party site: `signDirect` (Keplr-style) and
    `signAndBroadcast`, which hybrid-signs a native transaction with ML-DSA-87 and
    broadcasts it.
- **Even the planned `signArbitrary`** returns a QoreSign `MessageSignature`. Its ML-DSA
  part signs `"qorechain-msg-v1|" + chainId + "|" + data`
  (`qoresign` `messagePqSignBytes`). That is a domain-prefixed message, not our raw
  32-byte digest, and not the `"qorechain-siwq-v1|"` bytes that `verifySiwq` expects. So it
  can't feed `pqcVerify` over our digest either.
- **SIWQ itself** (`qoresign` `signSiwq` / `verifySiwq`) needs the classical ADR-36
  signature plus the ML-DSA-87 signature of the signing account. Today QoreX produces
  neither for our origin.

**Consequences for the spec:**
- **§3.2 (app role key): confirmed as needed.** Contract actions must be signed by an app
  key whose secret the browser holds. No QoreX path can sign our digest.
- **§3.2 / §7.3 "users sign in with QoreX (SIWQ)": not possible today.** Options:
  1. **SIWQ with the role key (recommended).** The role key is a full QoreChain account,
     so the app signs the SIWQ message with it (`signSiwq` with both keys), and the API
     verifies it with `verifySiwqWithChain` against the registered ML-DSA key. The Sign
     In With QoreChain feature is still used for real. QoreX is used only to read the
     user's `qor1` address (`eth_requestAccounts`, or `enable`/`getKey` on native).
  2. **Prove QoreX ownership with a transaction.** The user calls `signAndBroadcast` for a
     self-transfer of 1 uqor with the API's nonce in the memo. The API checks the
     included transaction, which the chain has already verified with the hybrid
     signature. This binds QoreX to the role key with real PQC, but costs a small fee
     per binding and needs the user's QoreX account to be funded.
  3. Wait for QoreX `signArbitrary` / `personal_sign`. These are announced, but there's
     no date, so we can't rely on them for 1 Dec.

  My suggestion: option 1 for the sign-in, plus option 2 as a one-time binding step
  (replacing the "SIWQ-signed statement" of §3.2), behind a flag. The mock's
  `"planned"` profile lets us test a `signArbitrary` path later.
- Side note: QoreX derives native accounts at `m/44'/118'/0'/0/i`
  (qorex-wallet-mock README), while our role keys use the unified EVM path
  `m/44'/60'/0'/0/0`. A user's QoreX address and their Paper Trail role address are
  always different accounts, so the binding is required.

---

## Q5. Relayer EVM window: limits, cost, unattended reopen

Sources: `@qorechain/evm` `dist/window.d.ts`, the template `scripts/window.ts` and
README, plus block times measured on diana.

- **Limits:** `MAX_EVM_WINDOW_BLOCKS = 17280`, `MAX_EVM_WINDOW_TXS = 1000`, and up to
  `MAX_EVM_WINDOW_TARGETS = 16` `allowedTargets`. `maxValue` (in uqor) caps value plus
  the maximum fee (gas limit × fee cap) of every admitted transaction.
- **Duration:** `blocks` is a block count. The average over the last 1,000 blocks
  (height about 10,430,834) was **1.429 s**. So the maximum window is **about 6.9 h**,
  and the template default of 600 blocks is about 14 min. The relayer therefore has to
  reopen at least about 4 times a day, including unattended through judging (6–15 Dec).
- **Unattended reopen: yes.** Opening is a native-lane `MsgOpenEVMWindow`, hybrid-signed
  with the relayer's own keys. `scripts/window.ts open` already does this from a
  mnemonic with no prompt. `@qorechain/evm` deliberately has no "auto-open" helper (*"the
  window exists so that spending is authorised on purpose"*), so our relayer's auto-reopen
  (§7.1) is explicit code. To keep it a deliberate authorisation, each window will:
  - set `allowedTargets = [PaperTrail]` (plus the deploy, done once by hand),
  - set a `maxValue` budget,
  - and alert on `classifyEvmWindowRejection`.
- **Nonce interaction:** opening a window *advances the account's nonce* (template
  README). The relayer's nonce manager must reopen the window and re-read the nonce in
  one serialised step, never while EVM transactions are in flight.
- **Cost:** pending. It's measured on the relayer's first `pnpm window open` once funded.

---

## Q6. Does `sealToAddresses` resolve the KEM key and the recipient card?

Source: `@qorechain/qoreseal` 0.1.0 `dist/network.js` (`resolveRecipient`,
`sealToAddresses`) and `dist/card-*.d.ts`.

- **KEM key: on-chain.** It is read from `GET /qorechain/pqc/v1/kem/{address}`
  (`fetchMlkemPublicKey`; it throws `KEM_KEY_NOT_REGISTERED` if there isn't one).
  `MsgRegisterKEMKey` *replaces* an existing key; unlike PQC registration it isn't refused
  a second time.
- **Recipient card: not on-chain; the app must host it.** In the default `hybrid` mode
  (ML-KEM-1024 + X25519), `resolveRecipient` needs `card` to be passed in. Without it,
  it throws `RECIPIENT_NEEDS_X25519`. The card (version 1) holds `address`,
  `mlkemKeySha3`, `x25519PublicKey`, `issuedAt` and a QoreSign `MessageSignature`. It is
  verified against **both** on-chain keys: the ML-DSA key (`/qorechain/pqc/v1/account/{addr}`)
  and the ML-KEM key.
- So spec §7.2 `User.sealCard` and §7.3 `GET /directory` are the right design. The API
  stores and serves cards, and clients call `sealToAddresses({ recipients: [{ address,
  card }] })`. The `mlkem` mode works without a card but drops the X25519 half, so we
  won't use it.
- *Still to do:* a live `fetchKemKey` on our accounts after registration.

---

## Q7. `EpochKeyManager` history restore across process restarts

Script: `scripts/findings/q7-epoch-restore.ts` (`pnpm findings:q7`, output in
`out/q7.txt`). It runs offline, with throwaway keys.

- **Restoring:** `new EpochKeyManager({ chainId, purpose, history, members })`, where
  `history` is `exportKeys()` (the last one is current) and `members` maps id to the
  public `SealRecipient`. `exportKeys()` does not include members, so the board's sealed
  state (`papertrail:board-state:v1`) must store **both** history and member recipients.
  There is no `history()` method, contrary to the spec's §2 wording; `history` is a
  constructor option.
- **Result** (two separate Node processes):
  - The restored epoch is 5, the same as when saved, and the keys are byte-equal.
  - Both old batches open.
  - `rotate()` then gives epoch 6, which inv1 and inv3 can open.
  - The removed inv2 is refused (`NOT_A_RECIPIENT`) on the removal envelope and on the
    new one.
- **Things to know for Phase 3:**
  - Each `addMember`, `removeMember` or `rotate` starts a new epoch, and the constructor
    starts at epoch 1. Passing the initial invigilators through the `members` option
    gives one epoch for setup instead of one per added member (fewer `rotateEpoch`
    txs).
  - **QoreSeal purpose and batch-context strings must match `^[A-Za-z0-9._:/-]{1,128}$`**
    (`PURPOSE_RE`, `dist/chunk-BDY7SXJP.js`). `|`, `‖` and spaces are refused with
    `INVALID_ARGUMENT`. Our purposes (`papertrail:centre:<id>` etc.) are fine. The §4.2
    release context `examId‖centreId` must become something like
    `<examId>:<centreId>` within 128 characters, and two `0x` hex bytes32 IDs (66
    characters each) don't fit. Options: use base64url IDs (43 characters each), or use
    `hex(keccak256(examId, centreId))` as the context.

---

## Q8. Is `shamir-secret-sharing` byte-identical in Node and the browser?

Package: `shamir-secret-sharing` 0.0.4 (Privy). Test: `scripts/findings/q8-shamir.test.ts`
(`pnpm findings:q8`, output in `out/q8-node.json` and `out/q8-jsdom.json`).

- **How the package is built:** one algorithm module (`esm/index.js`) and two random-number
  generators chosen by export condition. Under `node` it uses `csprng.node.js`
  (`node:crypto` `randomBytes`); otherwise `csprng.js` (`crypto.getRandomValues`).
  Shares are random by design, so two runs never give the same bytes. "Byte-identical"
  can only mean *identical given the same randomness*. I also checked that Node's
  `randomBytes` buffers aren't pooled, so `new Uint8Array(buf.buffer)` in the Node
  generator reads exactly the random bytes.
- **Result:** with the generator replaced by one fixed byte stream, a 2-of-3 split of a
  32-byte secret produced the same share bytes under Vitest's `node` environment and
  under `jsdom` (browser export conditions). Both gave SHA-256 `86e4d47d…` on every run.
  With real randomness, every 2-of-3 subset round-trips, and shares made under Node
  combine under jsdom.
- *Limit:* jsdom runs in Node, so this doesn't prove which generator module Vite loaded
  under jsdom. The algorithm is the same either way. The spec's Phase 3 test should run
  against the real browser bundle.

---

## Q9. Free API host that runs long-lived processes

**Constraint from your hosting choice:** you plan to run the API (and Postgres) on Vercel.
Vercel Functions have a maximum duration per invocation, 300 s on Hobby with Fluid
compute ([limits](https://vercel.com/docs/functions/limitations),
[changelog](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute)).
Nothing keeps running between requests. That affects three parts of the spec:

| Spec part | Needs | On Vercel |
|---|---|---|
| §7.1 ChainModule indexer (`watchContractEvent` + backfill) | A long-lived subscription | ❌ Replace with **catch-up on read**: before serving `/exams/:id`, `/released`, `/audit`, run `eth_getLogs` from the last indexed block (stored in Postgres) up to the latest block. A Vercel Cron job can also call `/internal/index`. |
| §7.1 Relayer window auto-reopen | A background check | ⚠️ Check **lazily before every relay**: if `remainingTxs < 3` or `remainingBlocks < 100`, reopen first (serialised with a Postgres advisory lock). During idle judging days there may be no window at all until the first request, which then pays one extra reopen, about one block of latency. |
| §7.3 SSE `/exams/:id/events` | Streams held open for minutes | ❌ Functions time out at 300 s. Use polling. The spec's cut order already allows "SSE → fall back to polling". |
| §9 uptime ping through 16 Dec | Keeps a server awake | No longer needed for the API; serverless starts on demand. |

Free always-on alternatives are unreliable on a zero budget.
- Render's free web services sleep after about 15 minutes idle.
- Reports on Koyeb's and Railway's free tiers conflict (some sources say Railway now gives
  only a one-time trial credit).
- Fly.io has no free tier for new accounts.

([summary](https://snapdeploy.dev/state-of-free-hosting),
[Render vs Railway](https://agentdeals.dev/railway-vs-render),
[always-on options](https://livemy.app/blog/free-hosting-that-doesnt-sleep), all
third-party, so check the vendors' pricing pages before relying on them.)

**Recommendation:** go with Vercel and the serverless adaptations in the table: indexing on
read, plus cron, lazy window management, and polling. This is a deviation from §7.1, §7.3
and §9, and Phase 4 needs your sign-off on it. *Not checked yet:* Vercel Cron frequency
limits on Hobby, and NestJS-on-Vercel packaging. Both are checked in Phase 4/7 before
relying on them.

---

## Submission note: the project page lists at most 5 addresses

The Fest project page takes up to 5 `qor1…` addresses on diana, and the organisers read
the chain for them. Every §11 network feature must be visible from those 5. Proposed:

| Address | Shows |
|---|---|
| relayer | EVM authorisation window, contract deploy, every EVM tx to PaperTrail (which runs the contract's `pqcVerify` + `pqcKeyStatus`), its own PQC + KEM registration |
| PaperTrail contract (`qor1…` form) | The contract with the Solidity PQC checks, and its events |
| board | PQC + KEM registration; ML-DSA signer of createExam / setCentre / rotateEpoch |
| examiner1 | PQC + KEM registration; release signer |
| examiner2 | PQC + KEM registration; release signer |

Sign In With QoreChain is off-chain, so the README and the video have to show it.
