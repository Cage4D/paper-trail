// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {PaperTrailLib} from "../src/PaperTrailLib.sol";
import {PaperTrail} from "../src/PaperTrail.sol";

/// @notice PaperTrailLib must reproduce test/vectors/digest-vectors.json, which is
/// generated independently with viem (scripts/vectors/gen-digest-vectors.ts) and is the
/// same file packages/core's actions.ts is tested against (Phase 3).
contract DigestVectorsTest is Test {
    using stdJson for string;

    string internal json;
    uint256 internal chainId;
    address internal verifyingContract;
    uint256 internal nonce;

    function setUp() public {
        json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/digest-vectors.json"));
        chainId = json.readUint(".chainId");
        verifyingContract = json.readAddress(".contract");
        nonce = json.readUint(".nonce");
    }

    function test_domain() public view {
        assertEq(PaperTrailLib.DOMAIN, json.readBytes32(".domain"));
    }

    function _check(string memory name, PaperTrailLib.Action action, bytes32 payloadHash) internal view {
        string memory k = string.concat(".vectors.", name);
        assertEq(json.readUint(string.concat(k, ".action")), uint256(action), string.concat(name, ": action id"));
        assertEq(payloadHash, json.readBytes32(string.concat(k, ".payloadHash")), string.concat(name, ": payloadHash"));
        address signer = json.readAddress(string.concat(k, ".signer"));
        assertEq(
            PaperTrailLib.digest(chainId, verifyingContract, action, signer, nonce, payloadHash),
            json.readBytes32(string.concat(k, ".digest")),
            string.concat(name, ": digest")
        );
    }

    function _b(string memory name, string memory field) internal view returns (bytes32) {
        return json.readBytes32(string.concat(".vectors.", name, ".fields.", field));
    }

    function _a(string memory name, string memory field) internal view returns (address) {
        return json.readAddress(string.concat(".vectors.", name, ".fields.", field));
    }

    function _u(string memory name, string memory field) internal view returns (uint64) {
        return uint64(json.readUint(string.concat(".vectors.", name, ".fields.", field)));
    }

    function test_examIdDerivation() public {
        // the vectors' examId (used by every later action) is examIdFor(board, salt)
        PaperTrail pt = new PaperTrail();
        assertEq(
            pt.examIdFor(_a("CreateExam", "board"), _b("CreateExam", "salt")), _b("SetCentre", "examId")
        );
    }

    function test_createExam() public view {
        address[] memory ex = json.readAddressArray(".vectors.CreateExam.fields.examiners");
        _check(
            "CreateExam",
            PaperTrailLib.Action.CreateExam,
            PaperTrailLib.createExamPayload(
                _b("CreateExam", "salt"),
                _a("CreateExam", "board"),
                [ex[0], ex[1], ex[2]],
                _u("CreateExam", "startTime"),
                _b("CreateExam", "masterCommitment"),
                _b("CreateExam", "committeeBundleHash")
            )
        );
    }

    function test_setCentre() public view {
        _check(
            "SetCentre",
            PaperTrailLib.Action.SetCentre,
            PaperTrailLib.setCentrePayload(
                _b("SetCentre", "examId"),
                _b("SetCentre", "centreId"),
                _b("SetCentre", "commitment"),
                _b("SetCentre", "cipherHash")
            )
        );
    }

    function test_rotateEpoch() public view {
        _check(
            "RotateEpoch",
            PaperTrailLib.Action.RotateEpoch,
            PaperTrailLib.rotateEpochPayload(
                _b("RotateEpoch", "centreId"),
                _a("RotateEpoch", "board"),
                _u("RotateEpoch", "epoch"),
                _b("RotateEpoch", "membersHash"),
                _b("RotateEpoch", "envelopeHash")
            )
        );
    }

    function test_release() public view {
        _check(
            "Release",
            PaperTrailLib.Action.Release,
            PaperTrailLib.releasePayload(
                _b("Release", "examId"), _b("Release", "centreId"), _b("Release", "blobHash"), _a("Release", "examiner")
            )
        );
    }

    function test_submitScript() public view {
        _check(
            "SubmitScript",
            PaperTrailLib.Action.SubmitScript,
            PaperTrailLib.submitScriptPayload(
                _b("SubmitScript", "examId"),
                _b("SubmitScript", "centreId"),
                _b("SubmitScript", "pseudonymHash"),
                _b("SubmitScript", "scriptHash"),
                _u("SubmitScript", "markerEpoch")
            )
        );
    }

    function test_publishMarks() public view {
        _check(
            "PublishMarks",
            PaperTrailLib.Action.PublishMarks,
            PaperTrailLib.publishMarksPayload(_b("PublishMarks", "examId"), _b("PublishMarks", "merkleRoot"))
        );
    }

    function test_bindIdentity() public view {
        _check(
            "BindIdentity",
            PaperTrailLib.Action.BindIdentity,
            PaperTrailLib.bindIdentityPayload(_a("BindIdentity", "role"), _b("BindIdentity", "statementHash"))
        );
    }
}
