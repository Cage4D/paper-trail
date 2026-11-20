# Phase 0 findings (spec §13)

Network: `qorechain-diana`, EVM chain id 9800. EVM RPC `https://evm-testnet.qore.host`,
REST `https://api-testnet.qore.host`. Kit versions: `@qorechain/sdk` 0.14.0, `@qorechain/evm`
0.14.0, `@qorechain/qoresign` 0.2.0, `@qorechain/qoreseal` 0.1.0, `@qorechain/pqc` 0.2.3
(wraps `@noble/post-quantum` 0.7.1).

Every claim below cites a script in `scripts/findings/` (raw output in
`scripts/findings/out/`) or a package source location.

| # | Question | Status |
|---|---|---|
| Q1 | `pqcVerify` takes ML-DSA-87 sizes? gas? | **Answered** |
| Q2 | QoreX raw ML-DSA / SIWQ signing | pending |
| Q3 | context string, algorithmId, raw vs pre-hash | **Answered** (algorithmId on-chain read pending a registered account) |
| Q4 | derivation works with registration? fees? | derivation **answered**; fees pending funding |
| Q5 | EVM window limits, cost, unattended reopen | pending |
| Q6 | `sealToAddresses` resolves KEM key + card? | pending |
| Q7 | `EpochKeyManager` history restore | pending |
| Q8 | `shamir-secret-sharing` Node = browser | pending |
| Q9 | free always-on API host | pending (now affected by the Vercel decision) |
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
  `NODE_OPTIONS=--dns-result-order=ipv4first` worked reliably.

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
