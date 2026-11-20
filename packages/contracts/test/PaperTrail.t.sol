// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {PaperTrail} from "../src/PaperTrail.sol";
import {PaperTrailLib} from "../src/PaperTrailLib.sol";
import {PaperTrailBase} from "./PaperTrailBase.t.sol";

/// @notice Spec §5.1 test matrix. Test names carry the matrix number (tNN_...).
/// Every negative case asserts the exact revert, so it can only pass for the right reason.
contract PaperTrailTest is PaperTrailBase {
    event ExamCreated(
        bytes32 indexed examId, address indexed board, address[3] examiners, uint64 startTime, bytes32 masterCommitment
    );
    event ShareReleased(
        bytes32 indexed examId, bytes32 indexed centreId, address indexed examiner, uint64 epoch, bytes32 blobHash
    );
    event Released(bytes32 indexed examId, bytes32 indexed centreId, uint64 epoch);

    // ── 1 ── createExam: board + 3 registered ML-DSA-87 examiners, valid board signature ✅
    function test01_createExam_valid() public {
        vm.expectEmit(address(pt));
        emit ExamCreated(pt.examIdFor(board, SALT), board, _examiners(), startTime, MASTER);
        _createExam();
        PaperTrail.Exam memory e = pt.getExam(examId);
        assertTrue(e.exists);
        assertEq(e.board, board);
        assertEq(e.examiners[2], ex3);
        assertEq(e.startTime, startTime);
        assertEq(e.committeeBundleHash, BUNDLE);
        assertEq(pt.nonces(board), 1);
    }

    // ── 2 ── an examiner without a registered key ❌
    function test02_createExam_examinerNotRegistered() public {
        status.setKey(ex3, false, 0, "");
        _expectCreateRevert(_examiners(), startTime, abi.encodeWithSelector(PaperTrail.KeyNotRegistered.selector, ex3));
    }

    function test02b_createExam_examinerWrongAlgorithm() public {
        status.setKey(ex2, true, 2, _pubkey(ex2)); // algorithm 2 = ML-KEM-1024, not a signature key
        _expectCreateRevert(_examiners(), startTime, abi.encodeWithSelector(PaperTrail.KeyNotRegistered.selector, ex2));
    }

    function test02c_createExam_boardNotRegistered() public {
        status.setKey(board, false, 0, "");
        _expectCreateRevert(_examiners(), startTime, abi.encodeWithSelector(PaperTrail.KeyNotRegistered.selector, board));
    }

    // ── 3 ── duplicate examiners / start time in the past ❌
    function test03_createExam_duplicateExaminers() public {
        _expectCreateRevert([ex1, ex1, ex3], startTime, abi.encodeWithSelector(PaperTrail.InvalidExaminers.selector));
        _expectCreateRevert([ex1, ex2, ex1], startTime, abi.encodeWithSelector(PaperTrail.InvalidExaminers.selector));
        _expectCreateRevert(
            [ex1, ex2, address(0)], startTime, abi.encodeWithSelector(PaperTrail.InvalidExaminers.selector)
        );
    }

    function test03b_createExam_startTimeNotInFuture() public {
        _expectCreateRevert(
            _examiners(), uint64(block.timestamp - 1), abi.encodeWithSelector(PaperTrail.StartTimeInPast.selector)
        );
        _expectCreateRevert(
            _examiners(), uint64(block.timestamp), abi.encodeWithSelector(PaperTrail.StartTimeInPast.selector)
        );
    }

    function test03c_createExam_twice() public {
        _createExam();
        _expectCreateRevert(_examiners(), startTime, abi.encodeWithSelector(PaperTrail.ExamExists.selector));
    }

    // ── 4 ── any action with a bad signature ❌
    function test04_badSignature_tampered() public {
        address[3] memory e = _examiners();
        bytes memory sig = _sign(
            board,
            PaperTrailLib.Action.CreateExam,
            PaperTrailLib.createExamPayload(SALT, board, e, startTime, MASTER, BUNDLE)
        );
        sig[5] ^= 0x01;
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.createExam(SALT, board, e, startTime, MASTER, BUNDLE, sig);
    }

    function test04b_badSignature_wrongSigner() public {
        _createExam();
        bytes32 c = keccak256("c");
        bytes32 h = keccak256("h");
        // examiner1 signs the board's setCentre digest with its own key
        bytes memory sig = _signDigest(
            ex1,
            PaperTrailLib.digest(
                block.chainid,
                address(pt),
                PaperTrailLib.Action.SetCentre,
                board,
                pt.nonces(board),
                PaperTrailLib.setCentrePayload(examId, CENTRE_A, c, h)
            )
        );
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.setCentre(examId, CENTRE_A, c, h, sig);
    }

    function test04c_badSignature_wrongLengthOrEmpty() public {
        bytes32 s = keccak256("statement");
        bytes memory good = _sign(ex1, PaperTrailLib.Action.BindIdentity, PaperTrailLib.bindIdentityPayload(ex1, s));
        bytes memory short = new bytes(4626);
        for (uint256 i = 0; i < 32; i++) {
            short[i] = good[i];
        }
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.bindIdentity(ex1, s, short);
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.bindIdentity(ex1, s, "");
    }

    function test04d_badSignature_tamperedPayload() public {
        // valid signature over one statement, submitted with another
        bytes memory sig = _sign(
            ex1, PaperTrailLib.Action.BindIdentity, PaperTrailLib.bindIdentityPayload(ex1, keccak256("signed"))
        );
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.bindIdentity(ex1, keccak256("submitted"), sig);
    }

    // ── 5 ── replay of a valid signed action (same nonce) ❌
    function test05_replay() public {
        bytes32 s = keccak256("statement");
        bytes memory sig = _sign(ex1, PaperTrailLib.Action.BindIdentity, PaperTrailLib.bindIdentityPayload(ex1, s));
        pt.bindIdentity(ex1, s, sig);
        assertEq(pt.identityBinding(ex1), s);
        assertEq(pt.nonces(ex1), 1);
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.bindIdentity(ex1, s, sig);
    }

    function test05b_replay_publishMarks() public {
        _createExam();
        bytes32 root = keccak256("root");
        bytes memory sig =
            _sign(board, PaperTrailLib.Action.PublishMarks, PaperTrailLib.publishMarksPayload(examId, root));
        pt.publishMarks(examId, root, sig);
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.publishMarks(examId, root, sig);
    }

    // ── 6 ── signature for another action / another contract / another chain id ❌
    function test06_wrongAction() public {
        bytes32 s = keccak256("statement");
        bytes32 ph = PaperTrailLib.bindIdentityPayload(ex1, s);
        bytes memory sig = _signDigest(
            ex1, PaperTrailLib.digest(block.chainid, address(pt), PaperTrailLib.Action.PublishMarks, ex1, 0, ph)
        );
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.bindIdentity(ex1, s, sig);
    }

    function test06b_wrongContract() public {
        bytes32 s = keccak256("statement");
        bytes32 ph = PaperTrailLib.bindIdentityPayload(ex1, s);
        PaperTrail other = new PaperTrail();
        bytes memory sigForOther = _signDigest(
            ex1, PaperTrailLib.digest(block.chainid, address(other), PaperTrailLib.Action.BindIdentity, ex1, 0, ph)
        );
        other.bindIdentity(ex1, s, sigForOther); // valid where it was meant to go
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.bindIdentity(ex1, s, sigForOther); // refused here
    }

    function test06c_wrongChainId() public {
        bytes32 s = keccak256("statement");
        bytes32 ph = PaperTrailLib.bindIdentityPayload(ex1, s);
        bytes memory sig9801 =
            _signDigest(ex1, PaperTrailLib.digest(9801, address(pt), PaperTrailLib.Action.BindIdentity, ex1, 0, ph));
        vm.chainId(9800);
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.bindIdentity(ex1, s, sig9801);
        vm.chainId(9801);
        pt.bindIdentity(ex1, s, sig9801); // the same bytes are valid only on 9801
    }

    // ── 7 ── setCentre after startTime, or twice for one centre ❌
    function test07_setCentre_afterStart() public {
        _createExam();
        vm.warp(startTime);
        bytes32 c = keccak256("c");
        bytes32 h = keccak256("h");
        bytes memory sig =
            _sign(board, PaperTrailLib.Action.SetCentre, PaperTrailLib.setCentrePayload(examId, CENTRE_A, c, h));
        vm.expectRevert(PaperTrail.SetupClosed.selector);
        pt.setCentre(examId, CENTRE_A, c, h, sig);
    }

    function test07b_setCentre_twice() public {
        _createExam();
        _setCentre(CENTRE_A);
        bytes32 c = keccak256("c2");
        bytes32 h = keccak256("h2");
        bytes memory sig =
            _sign(board, PaperTrailLib.Action.SetCentre, PaperTrailLib.setCentrePayload(examId, CENTRE_A, c, h));
        vm.expectRevert(PaperTrail.CentreAlreadySet.selector);
        pt.setCentre(examId, CENTRE_A, c, h, sig);
    }

    function test07c_setCentre_unknownExam() public {
        bytes32 c = keccak256("c");
        bytes32 h = keccak256("h");
        bytes memory sig =
            _sign(board, PaperTrailLib.Action.SetCentre, PaperTrailLib.setCentrePayload(examId, CENTRE_A, c, h));
        vm.expectRevert(PaperTrail.UnknownExam.selector);
        pt.setCentre(examId, CENTRE_A, c, h, sig);
    }

    // ── 8 ── release before startTime ❌
    function test08_release_tooEarly() public {
        _createExam();
        _setCentre(CENTRE_A);
        vm.warp(startTime - 1);
        bytes32 blob = keccak256("blob");
        bytes memory sig =
            _sign(ex1, PaperTrailLib.Action.Release, PaperTrailLib.releasePayload(examId, CENTRE_A, blob, ex1));
        vm.expectRevert(abi.encodeWithSelector(PaperTrail.TooEarly.selector, startTime));
        pt.release(examId, CENTRE_A, blob, ex1, sig);
    }

    // ── 9 ── release by a non-examiner (registered key, valid signature) ❌
    function test09_release_notExaminer() public {
        _createExam();
        _setCentre(CENTRE_A);
        vm.warp(startTime);
        bytes32 blob = keccak256("blob");
        bytes memory sig = _sign(
            outsider, PaperTrailLib.Action.Release, PaperTrailLib.releasePayload(examId, CENTRE_A, blob, outsider)
        );
        vm.expectRevert(abi.encodeWithSelector(PaperTrail.NotExaminer.selector, outsider));
        pt.release(examId, CENTRE_A, blob, outsider, sig);
    }

    function test09b_release_centreNotSet() public {
        _createExam();
        vm.warp(startTime);
        bytes32 blob = keccak256("blob");
        bytes memory sig =
            _sign(ex1, PaperTrailLib.Action.Release, PaperTrailLib.releasePayload(examId, CENTRE_B, blob, ex1));
        vm.expectRevert(PaperTrail.CentreNotSet.selector);
        pt.release(examId, CENTRE_B, blob, ex1, sig);
    }

    // ── 10 ── the same examiner releases twice ❌
    function test10_release_twice() public {
        _createExam();
        _setCentre(CENTRE_A);
        _rotate(CENTRE_A, board, 1);
        vm.warp(startTime);
        _release(CENTRE_A, ex1);
        bytes32 blob = keccak256("blob-again");
        bytes memory sig =
            _sign(ex1, PaperTrailLib.Action.Release, PaperTrailLib.releasePayload(examId, CENTRE_A, blob, ex1));
        vm.expectRevert(PaperTrail.AlreadyReleased.selector);
        pt.release(examId, CENTRE_A, blob, ex1, sig);
    }

    // ── 11 ── two releases → Released exactly once, with the centre's current epoch ✅
    function test11_twoReleases_releasedOnce_currentEpoch() public {
        _createExam();
        _setCentre(CENTRE_A);
        _setCentre(CENTRE_B);
        _rotate(CENTRE_A, board, 1);
        _rotate(CENTRE_A, board, 2);
        vm.warp(startTime);

        vm.recordLogs();
        _release(CENTRE_A, ex1);
        assertFalse(pt.releasedCentre(examId, CENTRE_A));
        assertEq(pt.releaseCount(examId, CENTRE_A), 1);

        vm.expectEmit(address(pt));
        emit Released(examId, CENTRE_A, 2);
        _release(CENTRE_A, ex3);
        assertTrue(pt.releasedCentre(examId, CENTRE_A));

        _release(CENTRE_A, ex2); // a third release is recorded but does not re-emit Released
        assertEq(pt.releaseCount(examId, CENTRE_A), 3);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 releasedEvents;
        uint256 shareEvents;
        for (uint256 i = 0; i < logs.length; i++) {
            // only the contract's logs: the test's own `emit` for vm.expectEmit is recorded too
            if (logs[i].emitter != address(pt)) continue;
            if (logs[i].topics[0] == Released.selector) {
                releasedEvents++;
                assertEq(abi.decode(logs[i].data, (uint64)), 2);
            }
            if (logs[i].topics[0] == ShareReleased.selector) {
                shareEvents++;
                (uint64 epoch,) = abi.decode(logs[i].data, (uint64, bytes32));
                assertEq(epoch, 2);
            }
        }
        assertEq(releasedEvents, 1);
        assertEq(shareEvents, 3);
        assertFalse(pt.releasedCentre(examId, CENTRE_B)); // other centres are independent
    }

    // ── 12 ── rotateEpoch skipping or repeating an epoch; by a non-board signer ❌
    function test12_rotate_skip() public {
        _expectRotateRevert(CENTRE_A, board, 2, abi.encodeWithSelector(PaperTrail.BadEpoch.selector, uint64(1)));
    }

    function test12b_rotate_repeat() public {
        _rotate(CENTRE_A, board, 1);
        assertEq(pt.centreEpoch(board, CENTRE_A), 1);
        _expectRotateRevert(CENTRE_A, board, 1, abi.encodeWithSelector(PaperTrail.BadEpoch.selector, uint64(2)));
        _rotate(CENTRE_A, board, 2);
        assertEq(pt.centreEpoch(board, CENTRE_A), 2);
    }

    function test12c_rotate_nonBoardSigner() public {
        _rotate(CENTRE_A, board, 1);
        // outsider, signing correctly for itself, only ever moves ITS OWN group for this centre id
        _rotate(CENTRE_A, outsider, 1);
        _rotate(CENTRE_A, outsider, 2);
        assertEq(pt.centreEpoch(outsider, CENTRE_A), 2);
        assertEq(pt.centreEpoch(board, CENTRE_A), 1); // the board's group is untouched
        // and a release for the board's exam records the board's epoch, not the outsider's
        _createExam();
        _setCentre(CENTRE_A);
        vm.warp(startTime);
        vm.recordLogs();
        _release(CENTRE_A, ex1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint64 epoch,) = abi.decode(logs[0].data, (uint64, bytes32));
        assertEq(epoch, 1);
    }

    function test12d_rotate_forgedBoardSignature() public {
        _rotate(CENTRE_A, board, 1);
        bytes32 mh = keccak256("m");
        bytes32 eh = keccak256("e");
        // outsider names the board but signs with its own key
        bytes memory sig = _signDigest(
            outsider,
            PaperTrailLib.digest(
                block.chainid,
                address(pt),
                PaperTrailLib.Action.RotateEpoch,
                board,
                pt.nonces(board),
                PaperTrailLib.rotateEpochPayload(CENTRE_A, board, 2, mh, eh)
            )
        );
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.rotateEpoch(CENTRE_A, board, 2, mh, eh, sig);
    }

    // ── extra: ids are namespaced by board, so a pending createExam cannot be squatted ──
    function test_createExam_frontRunSameSaltOtherBoard() public {
        // the outsider front-runs with the board's salt, signing as itself
        address[3] memory e = _examiners();
        bytes memory sig = _sign(
            outsider,
            PaperTrailLib.Action.CreateExam,
            PaperTrailLib.createExamPayload(SALT, outsider, e, startTime, MASTER, BUNDLE)
        );
        bytes32 squatted = pt.createExam(SALT, outsider, e, startTime, MASTER, BUNDLE, sig);
        assertTrue(squatted != examId);
        _createExam(); // the board's own exam still goes through, under its own id
        assertEq(pt.getExam(examId).board, board);
        assertEq(pt.getExam(squatted).board, outsider);
    }

    // ── extra: release needs the exam board's epoch group for that centre ──
    function test_release_noEpochGroup() public {
        _createExam();
        _setCentre(CENTRE_A);
        _rotate(CENTRE_A, outsider, 1); // another board's group does not count
        vm.warp(startTime);
        bytes32 blob = keccak256("blob");
        bytes memory sig =
            _sign(ex1, PaperTrailLib.Action.Release, PaperTrailLib.releasePayload(examId, CENTRE_A, blob, ex1));
        vm.expectRevert(PaperTrail.NoEpochGroup.selector);
        pt.release(examId, CENTRE_A, blob, ex1, sig);
    }

    // ── 13 ── submitScript before Released ❌ (and after ✅)
    function test13_submitScript_beforeReleased() public {
        _createExam();
        _setCentre(CENTRE_A);
        _rotate(CENTRE_A, board, 1);
        vm.warp(startTime);
        _release(CENTRE_A, ex1); // only one release: not yet Released
        bytes32 ph = PaperTrailLib.submitScriptPayload(examId, CENTRE_A, keccak256("p"), keccak256("s"), 1);
        bytes memory sig = _sign(board, PaperTrailLib.Action.SubmitScript, ph);
        vm.expectRevert(PaperTrail.NotReleased.selector);
        pt.submitScript(examId, CENTRE_A, keccak256("p"), keccak256("s"), 1, sig);

        _release(CENTRE_A, ex2);
        sig = _sign(board, PaperTrailLib.Action.SubmitScript, ph);
        pt.submitScript(examId, CENTRE_A, keccak256("p"), keccak256("s"), 1, sig);
    }

    // ── 14 ── publishMarks by a non-board signer ❌
    function test14_publishMarks_nonBoard() public {
        _createExam();
        bytes32 root = keccak256("root");
        bytes memory sig =
            _sign(outsider, PaperTrailLib.Action.PublishMarks, PaperTrailLib.publishMarksPayload(examId, root));
        vm.expectRevert(PaperTrail.BadSignature.selector);
        pt.publishMarks(examId, root, sig);
    }

    // ── 15 ── the relayer is any random account and every valid action still succeeds ✅
    function testFuzz15_untrustedRelayer(address anyRelayer) public {
        vm.assume(anyRelayer != address(0) && anyRelayer.code.length == 0);
        relayer = anyRelayer; // every helper submits via vm.prank(relayer)
        _createExam();
        _setCentre(CENTRE_A);
        _rotate(CENTRE_A, board, 1);
        vm.warp(startTime);
        _release(CENTRE_A, ex1);
        _release(CENTRE_A, ex2);
        assertTrue(pt.releasedCentre(examId, CENTRE_A));

        bytes32 ph = PaperTrailLib.submitScriptPayload(examId, CENTRE_A, keccak256("p"), keccak256("s"), 1);
        bytes memory sig = _sign(board, PaperTrailLib.Action.SubmitScript, ph);
        vm.prank(anyRelayer);
        pt.submitScript(examId, CENTRE_A, keccak256("p"), keccak256("s"), 1, sig);

        bytes32 root = keccak256("root");
        sig = _sign(board, PaperTrailLib.Action.PublishMarks, PaperTrailLib.publishMarksPayload(examId, root));
        vm.prank(anyRelayer);
        pt.publishMarks(examId, root, sig);

        bytes32 st = keccak256("statement");
        sig = _sign(ex3, PaperTrailLib.Action.BindIdentity, PaperTrailLib.bindIdentityPayload(ex3, st));
        vm.prank(anyRelayer);
        pt.bindIdentity(ex3, st, sig);
        assertEq(pt.identityBinding(ex3), st);
        // board signed 5 actions (create, setCentre, rotate, submitScript, publishMarks); the relayer signed none
        assertEq(pt.nonces(board), 5);
    }

    // ── extra: the public digest helper matches PaperTrailLib for the signer's next nonce ──
    function test_nextDigest_matchesLib() public {
        bytes32 ph = PaperTrailLib.bindIdentityPayload(ex1, keccak256("s"));
        vm.chainId(9800);
        assertEq(
            pt.nextDigest(PaperTrailLib.Action.BindIdentity, ex1, ph),
            PaperTrailLib.digest(9800, address(pt), PaperTrailLib.Action.BindIdentity, ex1, 0, ph)
        );
        pt.bindIdentity(ex1, keccak256("s"), _sign(ex1, PaperTrailLib.Action.BindIdentity, ph));
        assertEq(
            pt.nextDigest(PaperTrailLib.Action.BindIdentity, ex1, ph),
            PaperTrailLib.digest(9800, address(pt), PaperTrailLib.Action.BindIdentity, ex1, 1, ph)
        );
    }

    // ── helpers ──

    function _expectCreateRevert(address[3] memory e, uint64 start, bytes memory err) internal {
        bytes memory sig = _sign(
            board, PaperTrailLib.Action.CreateExam, PaperTrailLib.createExamPayload(SALT, board, e, start, MASTER, BUNDLE)
        );
        vm.expectRevert(err);
        pt.createExam(SALT, board, e, start, MASTER, BUNDLE, sig);
    }

    function _expectRotateRevert(bytes32 centreId, address signer, uint64 epoch, bytes memory err) internal {
        bytes32 mh = keccak256("m");
        bytes32 eh = keccak256("e");
        bytes memory sig = _sign(
            signer, PaperTrailLib.Action.RotateEpoch, PaperTrailLib.rotateEpochPayload(centreId, signer, epoch, mh, eh)
        );
        vm.expectRevert(err);
        pt.rotateEpoch(centreId, signer, epoch, mh, eh, sig);
    }
}
