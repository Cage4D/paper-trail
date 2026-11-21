// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title PaperTrailLib
/// @notice The byte-exact message format every Paper Trail action is signed over
///         (spec §4.4). `packages/core` (actions.ts) must reproduce these hashes
///         exactly; `test/vectors/digest-vectors.json` pins them for both sides.
///
/// QoreChain: the role holder signs the 32-byte `digest` with ML-DSA-87 (FIPS 204,
/// pure mode, EMPTY context string). The `pqcVerify` precompile verifies the
/// message bytes as given (no internal hashing), so the contract passes exactly
/// `abi.encodePacked(digest)` (findings Q1/Q3).
library PaperTrailLib {
    /// @notice Domain separator constant: keccak256("PaperTrail.v1").
    bytes32 internal constant DOMAIN = keccak256("PaperTrail.v1");

    /// @dev Order is part of the signed format: never reorder, only append.
    enum Action {
        CreateExam,
        SetCentre,
        RotateEpoch,
        Release,
        SubmitScript,
        PublishMarks,
        BindIdentity
    }

    /// @notice digest = keccak256(abi.encode(DOMAIN, chainId, contract, action, signer, nonce, payloadHash)).
    function digest(
        uint256 chainId,
        address verifyingContract,
        Action action,
        address signer,
        uint256 nonce,
        bytes32 payloadHash
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, chainId, verifyingContract, action, signer, nonce, payloadHash));
    }

    // ── payload hashes: keccak256(abi.encode(<action fields in calldata order>)) ──

    /// @dev Signs the salt, not the derived id; the id is keccak256(abi.encode(board, salt)).
    function createExamPayload(
        bytes32 salt,
        address board,
        address[3] memory examiners,
        uint64 startTime,
        bytes32 masterCommitment,
        bytes32 committeeBundleHash
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(salt, board, examiners, startTime, masterCommitment, committeeBundleHash));
    }

    function setCentrePayload(bytes32 examId, bytes32 centreId, bytes32 commitment_, bytes32 cipherHash_)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(examId, centreId, commitment_, cipherHash_));
    }

    function rotateEpochPayload(
        bytes32 centreId,
        address board,
        uint64 epoch,
        bytes32 membersHash,
        bytes32 envelopeHash
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(centreId, board, epoch, membersHash, envelopeHash));
    }

    /// @dev `epoch` is the group epoch the share was sealed for (must equal the current one).
    function releasePayload(bytes32 examId, bytes32 centreId, bytes32 blobHash, address examiner, uint64 epoch)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(examId, centreId, blobHash, examiner, epoch));
    }

    function submitScriptPayload(
        bytes32 examId,
        bytes32 centreId,
        bytes32 pseudonymHash,
        bytes32 scriptHash,
        uint64 markerEpoch
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(examId, centreId, pseudonymHash, scriptHash, markerEpoch));
    }

    function publishMarksPayload(bytes32 examId, bytes32 merkleRoot) internal pure returns (bytes32) {
        return keccak256(abi.encode(examId, merkleRoot));
    }

    function bindIdentityPayload(address role, bytes32 statementHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(role, statementHash));
    }
}
