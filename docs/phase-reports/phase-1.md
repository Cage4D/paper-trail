## Phase 1 complete — Contract

### What was built
- **`PaperTrail.sol`**, as in spec §5, with signature-authorised actions (decision D1).
  - `_auth` gates the signer through the `pqcKeyStatus` precompile (registered, `algorithmId == 1`).
  - It builds the domain-separated digest (DOMAIN, chain id, contract, action, signer, per-signer nonce, payload hash) and consumes the nonce.
  - It then requires `pqcVerify(pubkey, sig, abi.encodePacked(digest))`. That's pure ML-DSA-87 with an empty context over the raw 32 bytes, as measured in Q3.
  - It uses the checksummed precompile literals `0x…0a01` and `0x…0a02`.
- **`PaperTrailLib.sol`**: the signed message format (domain, digest, the seven payload hashes) as one library that the contract, the tests and the vectors share.
- **Precompile mocks** (`vm.etch`) that keep the real precompile's size checks, raw-message semantics and `false`-instead-of-revert behaviour.
- **The full §5.1 matrix**: 15 cases spread over 32 tests, including a fuzzed untrusted relayer.
- **Mutation checks:** 10 hand-made bugs, each caught by at least one test.
- **Shared digest vectors**, generated independently with viem and checked by Foundry. `packages/core` will be tested against the same file in Phase 3.
- **`PAPERTRAIL.md`**, documenting every function: signer, payload, preconditions, effects and errors.

### Files added / changed (path — purpose)
- `packages/contracts/src/PaperTrail.sol` — the contract
- `packages/contracts/src/PaperTrailLib.sol` — digest and payload-hash format (spec §4.4)
- `packages/contracts/test/mocks/MockPqc.sol` — `pqcKeyStatus` / `pqcVerify` test doubles
- `packages/contracts/test/PaperTrailBase.t.sol` — fixture: mocks at the real addresses, test keys, signing helpers
- `packages/contracts/test/PaperTrail.t.sol` — the §5.1 matrix (`test01_…` to `testFuzz15_…`), plus `nextDigest`
- `packages/contracts/test/DigestVectors.t.sol` — checks `PaperTrailLib` against the vectors
- `packages/contracts/test/vectors/digest-vectors.json` — the shared vectors (7 actions plus the domain)
- `scripts/vectors/gen-digest-vectors.ts` — the independent viem generator (`pnpm vectors`)
- `packages/contracts/foundry.toml` — read-only `fs_permissions` for `test/vectors` (the template is otherwise unchanged)
- `packages/contracts/PAPERTRAIL.md` — per-function documentation
- `package.json` — the `vectors` script

### How to check it yourself (copy-paste commands + what you should see)
```bash
cd packages/contracts && forge test
```
Expected: `43 tests passed, 0 failed` (PaperTrail 32, DigestVectors 8, template Counter 3).
```bash
forge test --match-contract PaperTrailTest -vv
```
Expected: one line per matrix case. The negative cases name the exact revert they expect.
```bash
pnpm vectors && git diff --exit-code packages/contracts/test/vectors
```
Run this from the repo root. It regenerates the vectors, and the file should come out unchanged.
```bash
forge build --force
```
Expected: no lint warnings. The remaining suppressions are annotated with their reasons.

### Results (tests X/Y; diana txids with explorer links)
- `forge test`: **43/43**. Workspace Vitest: 3/3. No diana transactions in this phase; deployment is Phase 2.
- **Mutation checks** (contract edited, then restored; each must make tests fail):

  | Mutant | Tests that fail |
  |---|---|
  | No nonce consumption | 4 |
  | Fixed chain id in `_auth` | 21 |
  | Wrong contract in `_auth` | 21 |
  | `pqcVerify` result ignored | 11 |
  | No time gate | 1 (test08) |
  | Release at 1 share | 2 (test11, test13) |
  | Double release allowed | 1 (test10) |
  | algorithmId not checked | 1 (test02b) |
  | Any board may rotate | 1 (test12c) |
  | `nextDigest` with a fixed chain | 1 |

  Every mutant was caught. An early run left the `nextDigest` view untested, so I added a test for it.
- **Gas with mocked precompiles:** setCentre ≈ 297k, release ≈ 320k, createExam ≈ 997k (four 2.6 KB key reads). Not representative: the real `pqcVerify` costs about 175k, and the real `pqcKeyStatus` cost is still unknown. Phase 2 measures both.

### Deviations from the spec (or "none")
1. **`rotateEpoch` takes an explicit `board` argument.** The spec says the first call "sets centreBoard", but the signature has no way to name that board. The signer is `board`. The first call binds it, and later calls must name the same board, otherwise `NotCentreBoard`.
2. **`release` also requires the centre to be set** for that exam (`CentreNotSet`). This isn't in the spec, but without it a release could target a centre that has no ciphertext.
3. **A third release is accepted.** It emits `ShareReleased` but no second `Released`. The spec only fixes "at 2 → Released exactly once".
4. **Added views:** `getExam` (the auto-generated getter drops `address[3]`) and `nextDigest`. The payload of each action is defined in `PaperTrailLib`, and `release` includes `examiner` in its payload, since `examiner` is a call field.
5. **Custom errors** instead of strings. They map onto the API error codes; the table is in `PAPERTRAIL.md`.
6. **Template change:** `foundry.toml` gets read-only `fs_permissions` so Foundry can read the vector file.

### Decisions I need from you (or "none")
1. **Front-running of IDs.** `examId` (in `createExam`) and `centreId` (on its first `rotateEpoch`) are first-come, first-served across all boards. An attacker with a registered key and an EVM window could watch the mempool and claim a pending `examId` first, or bind a `centreId` to their own board. That's denial of service, not a forgery: they can't sign as our board. Options:
   - **(a) recommended:** derive IDs inside the contract as `keccak256(abi.encode(board, id))`. Every board gets its own namespace and claiming someone else's ID becomes pointless. Small change; the vectors and docs get updated.
   - (b) keep as is, have the API generate random 32-byte IDs, and record the limitation in the README.
2. **Centre epoch vs the exam's board.** `release` records `centreEpoch[centreId]`, but a centre's epoch group is bound by whichever board rotated it first, not necessarily the exam's board. A release can also happen while the centre is still at epoch 0, with no invigilator group yet. Recommendation: in `release`, require `centreBoard[centreId] == exam.board` and `centreEpoch >= 1`. Otherwise the released share is sealed under an epoch key that doesn't exist yet or that the board doesn't control.
3. **Still open from Phase 0:**
   - fund examiner3 (`qor1d6lq980c4da0szehzeqezevtz8f7xm5qh935tq`), which Phase 2's `createExam` needs;
   - tell me which block explorer to link.

### Known issues / TODOs carried forward
- The nonce is one sequence per signer: a signer's actions have to land in the order they were signed. The Phase 4 API must queue each signer's actions in order and validate them before relaying, so one rejected action doesn't block the next.
- Real gas per action, and the cost of `pqcKeyStatus`, still need measuring on diana (Phase 2). If `createExam`'s four key reads turn out expensive, `_auth` can reuse the board key already read.
- The template's `Counter` contract and deploy script are still in place. Phase 2 adds a PaperTrail deploy script next to them.

### Next: Phase 2 — Contract on diana
- **Before deploying:** apply your answers to decisions 1–2 above, and register examiner3.
- **Deploy:** through the relayer, in a fresh EVM window. This first window can't be restricted to the contract, because the contract doesn't exist yet. After the deploy, I'll reopen a window with `allowedTargets = [PaperTrail]`.
- **Live smoke test with real ML-DSA-87 signatures from the role accounts:**
  1. createExam;
  2. setCentre ×2;
  3. rotateEpoch;
  4. an early release, which must revert with `TooEarly` (shown by simulation);
  5. two releases, then `Released`.
- **Output:** recorded txids and the real gas per action, plus a final yes/no on the D1 auth path, now with `pqcVerify` called from inside the contract.

Reply "proceed" to continue, or "proceed with changes: …".
