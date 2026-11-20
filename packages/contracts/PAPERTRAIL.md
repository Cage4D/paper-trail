# PaperTrail.sol

The on-chain half of Paper Trail: a post-quantum chain of custody for exam papers
on the QoreChain EVM lane (`qorechain-diana`, chain id 9800). It stores only hashes and
commitments. Every state change is **authorised by an ML-DSA-87 signature by the role
holder**, checked on-chain with QoreChain's PQC precompiles. Whoever submits the
transaction (in practice one relayer) is untrusted (spec §3.1, decision D1 in
`docs/findings.md`).

| File | What |
|---|---|
| `src/PaperTrail.sol` | The contract |
| `src/PaperTrailLib.sol` | The signed message format: domain, digest, per-action payload hashes |
| `test/PaperTrail.t.sol` | The spec §5.1 test matrix (precompiles mocked) |
| `test/DigestVectors.t.sol` + `test/vectors/digest-vectors.json` | Digest vectors shared with `packages/core` |
| `test/mocks/MockPqc.sol` | Test doubles of `pqcKeyStatus` / `pqcVerify` |

## How an action is authorised (`_auth`)

1. **Key status.** `pqcKeyStatus(signer)`, the precompile at `0x…0a02`, must return
   `registered = true` and `algorithmId == 1` (ML-DSA-87, confirmed on diana). The
   2,592-byte public key it returns is the one used to verify. Otherwise the call reverts
   with `KeyNotRegistered(signer)`.
2. **Digest.**
   ```
   digest = keccak256(abi.encode(
       keccak256("PaperTrail.v1"),   // DOMAIN
       block.chainid,                // 9800 on diana
       address(this),
       uint8(action),                // enum order below; never reordered
       signer,
       nonces[signer]++,             // consumed by this call
       payloadHash))                 // keccak256(abi.encode(<action fields>))
   ```
3. **Signature.** `pqcVerify(pubkey, sig, abi.encodePacked(digest))`, the precompile at
   `0x…0a01`, must return `true`. Otherwise the call reverts with `BadSignature()`.
   - Clients sign the **32-byte digest** with ML-DSA-87 in **pure mode with an empty
     context string** (FIPS 204). That's `pqSign` from `@qorechain/qoresign` or
     `pqcSign` from `@qorechain/sdk`.
   - The precompile verifies the message bytes as given. It doesn't hash them, and it
     rejects HashML-DSA and non-empty contexts (findings Q3).
   - Deterministic and hedged signatures are both accepted.

`nextDigest(action, signer, payloadHash)` returns the exact digest a signer must sign
next. Clients should still compute it themselves (`packages/core` `actions.ts`) and treat
the view only as a cross-check.

The nonce gives replay protection per signer, not per action. A signer's actions must be
submitted in the order they were signed. A signature made for nonce *n* is dead once any
other action of that signer consumes *n*.

Action ids: `CreateExam = 0`, `SetCentre = 1`, `RotateEpoch = 2`, `Release = 3`,
`SubmitScript = 4`, `PublishMarks = 5`, `BindIdentity = 6`.

## Functions

Each payload hash is `keccak256(abi.encode(...))` over exactly the fields listed, in that
order (see `PaperTrailLib`).

### `createExam(salt, board, examiners[3], startTime, masterCommitment, committeeBundleHash, sigBoard) → examId`
- **Signer:** `board`.
- **Payload:** `(salt, board, examiners, startTime, masterCommitment, committeeBundleHash)`.
- **Exam id:** `examId = examIdFor(board, salt) = keccak256(abi.encode(board, salt))`. IDs are namespaced by board. Someone who copies a pending `createExam` with their own board gets a different id, so they can't squat ours.
- **Requires:**
  - `salt`, `board` and `masterCommitment` are non-zero, and the derived `examId` is new;
  - `startTime > block.timestamp`;
  - the three examiners are non-zero and distinct;
  - **the board and all three examiners have registered ML-DSA-87 keys.**
- **Effects:** stores the exam (read it with `getExam`), returns `examId`, and emits `ExamCreated(examId, …)`.
- **Errors:** `ExamExists`, `ZeroValue`, `StartTimeInPast`, `InvalidExaminers`, `KeyNotRegistered`, `BadSignature`.

### `setCentre(examId, centreId, commitment, cipherHash, sigBoard)`
- **Signer:** the exam's board.
- **Payload:** `(examId, centreId, commitment, cipherHash)`.
- **Requires:** the exam exists; `block.timestamp < startTime`; the centre isn't set yet for this exam; the ids and hashes are non-zero.
- **Effects:** records the centre's variant commitment (SHA3-256 of the variant) and the hash of its ciphertext. Emits `CentreSet`.
- **Errors:** `UnknownExam`, `SetupClosed`, `CentreAlreadySet`, `ZeroValue`, `KeyNotRegistered`, `BadSignature`.

### `rotateEpoch(centreId, board, epoch, membersHash, envelopeHash, sigBoard)`
- **Signer:** `board`.
- **Payload:** `(centreId, board, epoch, membersHash, envelopeHash)`.
- **Namespace:** epoch groups are keyed by `(board, centreId)`. A board can only ever move its own groups, so nobody can claim or advance another board's centre.
- **Requires:** `epoch == centreEpoch[board][centreId] + 1`, and the ids are non-zero.
- **Effects:** advances that board's QoreSeal epoch group for the centre and emits `EpochChanged(board, centreId, …)`. The envelope itself is stored off-chain by the API; only its hash is recorded here.
- **Errors:** `ZeroValue`, `BadEpoch(expected)`, `KeyNotRegistered`, `BadSignature`.

### `release(examId, centreId, blobHash, examiner, sigExaminer)`
- **Signer:** `examiner`.
- **Payload:** `(examId, centreId, blobHash, examiner)`.
- **Requires:**
  - `examiner` is one of the exam's three examiners;
  - `block.timestamp >= startTime`;
  - the centre is set for this exam;
  - **the exam board's epoch group for the centre exists** (`centreEpoch[exam.board][centreId] >= 1`). The released share is sealed under that group's current key, so another board's group never counts;
  - this examiner hasn't released this centre yet.
- **Effects:** records the release with the **current epoch of the exam board's group** for the centre, and emits `ShareReleased`. The second distinct release emits `Released(examId, centreId, epoch)`, **exactly once**. A third release is still recorded (`ShareReleased`) but doesn't re-emit `Released`.
- **Errors:** `UnknownExam`, `NotExaminer`, `TooEarly(startTime)`, `CentreNotSet`, `NoEpochGroup`, `AlreadyReleased`, `ZeroValue`, `KeyNotRegistered`, `BadSignature`.

### `submitScript(examId, centreId, pseudonymHash, scriptHash, markerEpoch, sigBoard)`
- **Signer:** the exam's board. In v1 the board relays it; candidates have no role keys.
- **Payload:** `(examId, centreId, pseudonymHash, scriptHash, markerEpoch)`.
- **Requires:** the centre is `Released`.
- **Effects:** emits `ScriptSubmitted`. Nothing is stored; the event is the record.
- **Errors:** `UnknownExam`, `NotReleased`, `KeyNotRegistered`, `BadSignature`.

### `publishMarks(examId, merkleRoot, sigBoard)`
- **Signer:** the exam's board.
- **Payload:** `(examId, merkleRoot)`.
- **Requires:** the exam exists and `merkleRoot` is non-zero.
- **Effects:** emits `MarksPublished`.
- **Errors:** `UnknownExam`, `ZeroValue`, `KeyNotRegistered`, `BadSignature`.

### `bindIdentity(role, statementHash, sigRole)`
- **Signer:** `role`.
- **Payload:** `(role, statementHash)`.
- **Effects:** `identityBinding[role] = statementHash`. Emits `IdentityBound`. The statement links a role key to a QoreX identity (decision D2).
- **Errors:** `ZeroValue`, `KeyNotRegistered`, `BadSignature`.

### Views
- `getExam(examId)`: the full `Exam` struct. The auto-generated getter would drop the examiner array.
- `examIdFor(board, salt)`: the derived exam id.
- `nextDigest(action, signer, payloadHash)`: the digest the signer must sign next.
- Public mappings: `commitment`, `cipherHash`, `releaseCount`, `hasReleased`, `centreEpoch(board, centreId)`, `releasedCentre`, `nonces`, `identityBinding`.
- `ML_DSA_87` is `1`.

## Error → API code (spec §7.4)

| Contract error | API code |
|---|---|
| `TooEarly` | `TOO_EARLY` |
| `NotReleased` | `NOT_RELEASED` |
| `NotExaminer` | `NOT_EXAMINER` |
| `AlreadyReleased` | `ALREADY_RELEASED` |
| `KeyNotRegistered` | `KEY_NOT_REGISTERED` |
| `BadSignature` | `BAD_SIGNATURE` |

The other errors are input-validation failures. The API rejects those before relaying.

## Gas

In the Foundry gas report, typical action costs with the **mocked** precompiles are
setCentre ≈ 297k, rotateEpoch ≈ 291k, release ≈ 320k, publishMarks ≈ 249k and
createExam ≈ 997k. createExam reads four 2,592-byte keys, and the mock's cost is mostly
storage reads of those keys.

These figures **don't reflect the real precompiles**. On diana, `pqcVerify` alone costs
about 175k gas (findings Q1), and the cost of `pqcKeyStatus` isn't known yet. Phase 2
measures the real cost per action on diana.

## Testing

```sh
forge test                          # all suites
forge test --match-contract PaperTrailTest -vv
forge test --match-contract DigestVectors
```

The precompile mocks are `vm.etch`-ed at `0x…0a01` and `0x…0a02`. They keep the real
precompile's exact-size checks and its raw-message semantics, and they return `false`
rather than reverting on bad input. Each test key has a secret, and a valid mock
signature is `keccak256(secret ‖ message)` padded to 4,627 bytes. Real ML-DSA-87 is
exercised against the real precompiles in Phase 2.
