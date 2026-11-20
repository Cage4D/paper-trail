// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {PaperTrailLib} from "./PaperTrailLib.sol";

/// @notice QoreChain post-quantum precompiles (`@qorechain/evm` IQORE_PQC_ABI).
interface IQorePQC {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey);
}

/// @title PaperTrail
/// @notice Post-quantum chain of custody for exam papers (spec §5).
///
/// Every state change carries an ML-DSA-87 signature by the role holder over a
/// domain-separated digest (PaperTrailLib.digest). The contract looks up the
/// signer's registered key with the `pqcKeyStatus` precompile and checks the
/// signature with the `pqcVerify` precompile. `msg.sender` is ignored: any account
/// (in practice the relayer, which holds the EVM authorisation window and pays gas)
/// may submit a signed action, and it cannot forge one (spec §3.1, decision D1).
contract PaperTrail {
    // ── QoreChain precompiles (active on qorechain-diana, not on mainnet) ──
    // EIP-55 checksummed literals: solc rejects the upper-case "0A01" form (findings Q3).
    IQorePQC internal constant PQC_VERIFY = IQorePQC(0x0000000000000000000000000000000000000a01);
    IQorePQC internal constant PQC_STATUS = IQorePQC(0x0000000000000000000000000000000000000a02);
    /// @notice ML-DSA-87 algorithm id returned by `pqcKeyStatus` (confirmed on diana, findings Q3).
    uint8 public constant ML_DSA_87 = 1;

    struct Exam {
        address board;
        address[3] examiners;
        uint64 startTime;
        bytes32 masterCommitment;
        bytes32 committeeBundleHash;
        bool exists;
    }

    mapping(bytes32 => Exam) internal _exams;
    mapping(bytes32 => mapping(bytes32 => bytes32)) public commitment; // exam => centre => SHA3-256(variant)
    mapping(bytes32 => mapping(bytes32 => bytes32)) public cipherHash; // exam => centre => hash(C_c)
    mapping(bytes32 => mapping(bytes32 => uint8)) public releaseCount;
    mapping(bytes32 => mapping(bytes32 => mapping(address => bool))) public hasReleased;
    mapping(bytes32 => address) public centreBoard; // centre => board (set by its first rotateEpoch)
    mapping(bytes32 => uint64) public centreEpoch; // centre => current epoch (0 = none yet)
    mapping(bytes32 => mapping(bytes32 => bool)) public releasedCentre;
    mapping(address => uint256) public nonces; // per-signer replay protection
    mapping(address => bytes32) public identityBinding; // role addr => hash(binding statement)

    event ExamCreated(
        bytes32 indexed examId, address indexed board, address[3] examiners, uint64 startTime, bytes32 masterCommitment
    );
    event CentreSet(bytes32 indexed examId, bytes32 indexed centreId, bytes32 commitment, bytes32 cipherHash);
    event EpochChanged(bytes32 indexed centreId, uint64 epoch, bytes32 membersHash, bytes32 envelopeHash);
    event ShareReleased(
        bytes32 indexed examId, bytes32 indexed centreId, address indexed examiner, uint64 epoch, bytes32 blobHash
    );
    event Released(bytes32 indexed examId, bytes32 indexed centreId, uint64 epoch);
    event ScriptSubmitted(
        bytes32 indexed examId, bytes32 indexed centreId, bytes32 pseudonymHash, bytes32 scriptHash, uint64 markerEpoch
    );
    event MarksPublished(bytes32 indexed examId, bytes32 merkleRoot);
    event IdentityBound(address indexed role, bytes32 statementHash);

    // Errors map onto the API error catalog (spec §7.4) where one exists.
    error KeyNotRegistered(address account); // KEY_NOT_REGISTERED
    error BadSignature(); // BAD_SIGNATURE
    error TooEarly(uint64 startTime); // TOO_EARLY
    error NotExaminer(address account); // NOT_EXAMINER
    error AlreadyReleased(); // ALREADY_RELEASED
    error NotReleased(); // NOT_RELEASED
    error ExamExists();
    error UnknownExam();
    error InvalidExaminers();
    error StartTimeInPast();
    error CentreAlreadySet();
    error CentreNotSet();
    error ZeroValue();
    error SetupClosed(); // setCentre at or after startTime
    error BadEpoch(uint64 expected);
    error NotCentreBoard();

    // ───────────────────────────── views ─────────────────────────────

    /// @notice The exam record (the public getter of a struct with a fixed array omits the array).
    function getExam(bytes32 examId) external view returns (Exam memory) {
        return _exams[examId];
    }

    /// @notice The digest `signer` must sign next for `action` with this payload hash.
    function nextDigest(PaperTrailLib.Action action, address signer, bytes32 payloadHash)
        external
        view
        returns (bytes32)
    {
        return PaperTrailLib.digest(block.chainid, address(this), action, signer, nonces[signer], payloadHash);
    }

    // ──────────────────────────── actions ────────────────────────────

    /// @notice Board creates an exam with three distinct examiners, all with registered ML-DSA-87 keys.
    function createExam(
        bytes32 examId,
        address board,
        address[3] calldata examiners,
        uint64 startTime,
        bytes32 masterCommitment,
        bytes32 committeeBundleHash,
        bytes calldata sigBoard
    ) external {
        if (_exams[examId].exists) revert ExamExists();
        if (examId == bytes32(0) || masterCommitment == bytes32(0)) revert ZeroValue();
        // forge-lint: disable-next-line(block-timestamp) -- the exam time gate is block time by design (spec §5)
        if (startTime <= block.timestamp) revert StartTimeInPast();
        // Fixed 3 iterations: distinct, non-zero examiners with registered ML-DSA-87 keys.
        for (uint256 i = 0; i < 3; i++) {
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (examiners[i] == address(0)) revert InvalidExaminers();
            for (uint256 j = i + 1; j < 3; j++) {
                // forge-lint: disable-next-line(require-revert-in-loop)
                if (examiners[i] == examiners[j]) revert InvalidExaminers();
            }
            // forge-lint: disable-next-line(calls-loop) -- view precompile, 3 calls
            _requireRegistered(examiners[i]);
        }
        _auth(
            board,
            PaperTrailLib.Action.CreateExam,
            PaperTrailLib.createExamPayload(examId, board, examiners, startTime, masterCommitment, committeeBundleHash),
            sigBoard
        );
        _exams[examId] = Exam(board, examiners, startTime, masterCommitment, committeeBundleHash, true);
        emit ExamCreated(examId, board, examiners, startTime, masterCommitment);
    }

    /// @notice Board registers one centre's copy (commitment + ciphertext hash), once, before startTime.
    function setCentre(bytes32 examId, bytes32 centreId, bytes32 commitment_, bytes32 cipherHash_, bytes calldata sigBoard)
        external
    {
        Exam storage e = _exam(examId);
        // forge-lint: disable-next-line(block-timestamp) -- the exam time gate is block time by design (spec §5)
        if (block.timestamp >= e.startTime) revert SetupClosed();
        if (commitment[examId][centreId] != bytes32(0)) revert CentreAlreadySet();
        if (centreId == bytes32(0) || commitment_ == bytes32(0) || cipherHash_ == bytes32(0)) revert ZeroValue();
        _auth(
            e.board,
            PaperTrailLib.Action.SetCentre,
            PaperTrailLib.setCentrePayload(examId, centreId, commitment_, cipherHash_),
            sigBoard
        );
        commitment[examId][centreId] = commitment_;
        cipherHash[examId][centreId] = cipherHash_;
        emit CentreSet(examId, centreId, commitment_, cipherHash_);
    }

    /// @notice Board moves a centre's QoreSeal epoch group to `epoch` (= current + 1).
    /// @dev `board` is explicit because the first call (epoch 1) is what binds the
    ///      centre to its board; later calls must come from that same board.
    function rotateEpoch(
        bytes32 centreId,
        address board,
        uint64 epoch,
        bytes32 membersHash,
        bytes32 envelopeHash,
        bytes calldata sigBoard
    ) external {
        if (centreId == bytes32(0)) revert ZeroValue();
        address bound = centreBoard[centreId];
        if (bound != address(0) && bound != board) revert NotCentreBoard();
        uint64 expected = centreEpoch[centreId] + 1;
        if (epoch != expected) revert BadEpoch(expected);
        _auth(
            board,
            PaperTrailLib.Action.RotateEpoch,
            PaperTrailLib.rotateEpochPayload(centreId, board, epoch, membersHash, envelopeHash),
            sigBoard
        );
        if (bound == address(0)) centreBoard[centreId] = board;
        centreEpoch[centreId] = epoch;
        emit EpochChanged(centreId, epoch, membersHash, envelopeHash);
    }

    /// @notice An examiner releases their share for one centre, at or after startTime.
    ///         The second distinct release emits `Released` (exactly once).
    function release(bytes32 examId, bytes32 centreId, bytes32 blobHash, address examiner, bytes calldata sigExaminer)
        external
    {
        Exam storage e = _exam(examId);
        if (!_isExaminer(e, examiner)) revert NotExaminer(examiner);
        // forge-lint: disable-next-line(block-timestamp) -- the exam time gate is block time by design (spec §5)
        if (block.timestamp < e.startTime) revert TooEarly(e.startTime);
        if (commitment[examId][centreId] == bytes32(0)) revert CentreNotSet();
        if (hasReleased[examId][centreId][examiner]) revert AlreadyReleased();
        if (blobHash == bytes32(0)) revert ZeroValue();
        _auth(
            examiner,
            PaperTrailLib.Action.Release,
            PaperTrailLib.releasePayload(examId, centreId, blobHash, examiner),
            sigExaminer
        );
        hasReleased[examId][centreId][examiner] = true;
        uint8 count = ++releaseCount[examId][centreId];
        uint64 epoch = centreEpoch[centreId];
        emit ShareReleased(examId, centreId, examiner, epoch, blobHash);
        if (count >= 2 && !releasedCentre[examId][centreId]) {
            releasedCentre[examId][centreId] = true;
            emit Released(examId, centreId, epoch);
        }
    }

    /// @notice Board records a sealed answer script for a released centre (v1: board-signed).
    function submitScript(
        bytes32 examId,
        bytes32 centreId,
        bytes32 pseudonymHash,
        bytes32 scriptHash,
        uint64 markerEpoch,
        bytes calldata sigBoard
    ) external {
        Exam storage e = _exam(examId);
        if (!releasedCentre[examId][centreId]) revert NotReleased();
        _auth(
            e.board,
            PaperTrailLib.Action.SubmitScript,
            PaperTrailLib.submitScriptPayload(examId, centreId, pseudonymHash, scriptHash, markerEpoch),
            sigBoard
        );
        emit ScriptSubmitted(examId, centreId, pseudonymHash, scriptHash, markerEpoch);
    }

    /// @notice Board publishes the Merkle root of the marks.
    function publishMarks(bytes32 examId, bytes32 merkleRoot, bytes calldata sigBoard) external {
        Exam storage e = _exam(examId);
        if (merkleRoot == bytes32(0)) revert ZeroValue();
        _auth(e.board, PaperTrailLib.Action.PublishMarks, PaperTrailLib.publishMarksPayload(examId, merkleRoot), sigBoard);
        emit MarksPublished(examId, merkleRoot);
    }

    /// @notice A role key records the hash of the statement binding it to a QoreX identity.
    function bindIdentity(address role, bytes32 statementHash, bytes calldata sigRole) external {
        if (statementHash == bytes32(0)) revert ZeroValue();
        _auth(role, PaperTrailLib.Action.BindIdentity, PaperTrailLib.bindIdentityPayload(role, statementHash), sigRole);
        identityBinding[role] = statementHash;
        emit IdentityBound(role, statementHash);
    }

    // ─────────────────────────── internals ───────────────────────────

    /// @dev The signature check behind every action:
    ///  1. `pqcKeyStatus(signer)` must report a registered ML-DSA-87 key;
    ///  2. the digest binds DOMAIN, chain id, this contract, the action, the signer,
    ///     the signer's current nonce and the payload hash; the nonce is consumed;
    ///  3. `pqcVerify(pubkey, sig, digest)` must return true.
    function _auth(address signer, PaperTrailLib.Action action, bytes32 payloadHash, bytes calldata sig) internal {
        bytes memory pubkey = _requireRegistered(signer);
        bytes32 d = PaperTrailLib.digest(block.chainid, address(this), action, signer, nonces[signer]++, payloadHash);
        if (!PQC_VERIFY.pqcVerify(pubkey, sig, abi.encodePacked(d))) revert BadSignature();
    }

    /// @dev Returns the account's registered ML-DSA-87 public key, or reverts.
    function _requireRegistered(address account) internal view returns (bytes memory pubkey) {
        // Also reached from createExam's fixed 3-examiner loop (lint: calls-loop, revert-in-loop).
        // forge-lint: disable-next-line(calls-loop)
        (bool registered, uint8 algorithmId, bytes memory pk) = PQC_STATUS.pqcKeyStatus(account);
        // forge-lint: disable-next-line(require-revert-in-loop)
        if (!registered || algorithmId != ML_DSA_87 || pk.length == 0) revert KeyNotRegistered(account);
        return pk;
    }

    function _exam(bytes32 examId) internal view returns (Exam storage e) {
        e = _exams[examId];
        if (!e.exists) revert UnknownExam();
    }

    function _isExaminer(Exam storage e, address account) internal view returns (bool) {
        return account != address(0)
            && (account == e.examiners[0] || account == e.examiners[1] || account == e.examiners[2]);
    }
}
