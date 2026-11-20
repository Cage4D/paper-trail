// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PaperTrail} from "../src/PaperTrail.sol";
import {PaperTrailLib} from "../src/PaperTrailLib.sol";
import {MockPqcKeyStatus, MockPqcVerify} from "./mocks/MockPqc.sol";

/// @notice Shared fixture: precompile mocks at the real addresses, test keys, signing helpers.
abstract contract PaperTrailBase is Test {
    address internal constant PQC_VERIFY_ADDR = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_STATUS_ADDR = 0x0000000000000000000000000000000000000a02;
    uint8 internal constant ML_DSA_87 = 1;

    PaperTrail internal pt;
    MockPqcKeyStatus internal status = MockPqcKeyStatus(PQC_STATUS_ADDR);
    MockPqcVerify internal verifier = MockPqcVerify(PQC_VERIFY_ADDR);

    address internal board = makeAddr("board");
    address internal ex1 = makeAddr("examiner1");
    address internal ex2 = makeAddr("examiner2");
    address internal ex3 = makeAddr("examiner3");
    address internal outsider = makeAddr("outsider");
    address internal relayer = makeAddr("relayer");

    bytes32 internal constant EXAM = keccak256("exam-1");
    bytes32 internal constant CENTRE_A = keccak256("centre-A");
    bytes32 internal constant CENTRE_B = keccak256("centre-B");
    bytes32 internal constant MASTER = keccak256("master-commitment");
    bytes32 internal constant BUNDLE = keccak256("committee-bundle");
    uint64 internal startTime;

    mapping(address => bytes32) internal secretOf;

    function setUp() public virtual {
        vm.etch(PQC_STATUS_ADDR, type(MockPqcKeyStatus).runtimeCode);
        vm.etch(PQC_VERIFY_ADDR, type(MockPqcVerify).runtimeCode);
        vm.warp(1_800_000_000);
        startTime = uint64(block.timestamp + 1 hours);
        pt = new PaperTrail();
        _register(board);
        _register(ex1);
        _register(ex2);
        _register(ex3);
        _register(outsider);
    }

    // ── keys ──

    function _pubkey(address who) internal pure returns (bytes memory pk) {
        pk = new bytes(2592);
        bytes32 seed = keccak256(abi.encode("pk", who));
        for (uint256 i = 0; i < 2592; i++) {
            if (i % 32 == 0) seed = keccak256(abi.encode(seed));
            pk[i] = seed[i % 32];
        }
    }

    function _register(address who) internal {
        bytes32 secret = keccak256(abi.encode("secret", who));
        secretOf[who] = secret;
        bytes memory pk = _pubkey(who);
        status.setKey(who, true, ML_DSA_87, pk);
        verifier.setSecret(pk, secret);
    }

    /// @dev Mock ML-DSA-87 signature by `who` over the 32-byte digest (4,627 bytes long).
    function _signDigest(address who, bytes32 digest) internal view returns (bytes memory sig) {
        sig = new bytes(4627);
        bytes32 tag = keccak256(abi.encodePacked(secretOf[who], abi.encodePacked(digest)));
        for (uint256 i = 0; i < 32; i++) {
            sig[i] = tag[i];
        }
    }

    /// @dev Signature for the signer's NEXT nonce on this contract and chain.
    function _sign(address who, PaperTrailLib.Action action, bytes32 payloadHash) internal view returns (bytes memory) {
        return _signDigest(
            who, PaperTrailLib.digest(block.chainid, address(pt), action, who, pt.nonces(who), payloadHash)
        );
    }

    // ── action helpers (signed correctly, submitted by the untrusted relayer) ──

    function _examiners() internal view returns (address[3] memory e) {
        e = [ex1, ex2, ex3];
    }

    function _createExam() internal {
        address[3] memory e = _examiners();
        bytes memory sig = _sign(
            board,
            PaperTrailLib.Action.CreateExam,
            PaperTrailLib.createExamPayload(EXAM, board, e, startTime, MASTER, BUNDLE)
        );
        vm.prank(relayer);
        pt.createExam(EXAM, board, e, startTime, MASTER, BUNDLE, sig);
    }

    function _setCentre(bytes32 centreId) internal {
        bytes32 c = keccak256(abi.encode("commitment", centreId));
        bytes32 h = keccak256(abi.encode("cipher", centreId));
        bytes memory sig =
            _sign(board, PaperTrailLib.Action.SetCentre, PaperTrailLib.setCentrePayload(EXAM, centreId, c, h));
        vm.prank(relayer);
        pt.setCentre(EXAM, centreId, c, h, sig);
    }

    function _rotate(bytes32 centreId, address signer, uint64 epoch) internal {
        bytes32 mh = keccak256(abi.encode("members", centreId, epoch));
        bytes32 eh = keccak256(abi.encode("envelope", centreId, epoch));
        bytes memory sig = _sign(
            signer, PaperTrailLib.Action.RotateEpoch, PaperTrailLib.rotateEpochPayload(centreId, signer, epoch, mh, eh)
        );
        vm.prank(relayer);
        pt.rotateEpoch(centreId, signer, epoch, mh, eh, sig);
    }

    function _release(bytes32 centreId, address examiner) internal {
        bytes32 blob = keccak256(abi.encode("blob", centreId, examiner));
        bytes memory sig = _sign(
            examiner, PaperTrailLib.Action.Release, PaperTrailLib.releasePayload(EXAM, centreId, blob, examiner)
        );
        vm.prank(relayer);
        pt.release(EXAM, centreId, blob, examiner, sig);
    }
}
