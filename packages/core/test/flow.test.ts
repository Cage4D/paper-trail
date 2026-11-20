/**
 * End-to-end crypto flow (spec §6 "round-trip of every flow"), offline:
 * set → groups → release ×2 (with a revocation in between) → invigilator opens + authenticity
 * check → scripts sealed to markers → leak traced back to the centre.
 */
import { describe, expect, it } from "vitest";
import { setExam, openCommitteeBundle } from "../src/split.js";
import { BoardGroups, centreGroupKey } from "../src/groups.js";
import { openPaper, prepareRelease, releaseRecipientsMatch } from "../src/release.js";
import { openScript, sealScript, newPseudonym } from "../src/scripts.js";
import { matchLeak } from "../src/detect.js";
import { CENTRE_A, CENTRE_B, EXAM_ID, SAMPLE, cast, part } from "./fixtures.js";

const [i1, i2, i3] = cast.inv;
const setup = await setExam({ paperMarkdown: SAMPLE, examId: EXAM_ID, examiners: [part(cast.ex[0]), part(cast.ex[1]), part(cast.ex[2])], board: part(cast.board), centreIds: [CENTRE_A, CENTRE_B] });
const A = setup.centres[0];
const board = new BoardGroups();
const GA = centreGroupKey(CENTRE_A);
board.create(GA, { [i1.evm]: i1.recipient, [i2.evm]: i2.recipient }); // epoch 1
board.create(centreGroupKey(CENTRE_B), { [i3.evm]: i3.recipient });

// examiner 0 releases at epoch 1 (i1 + i2) …
const r0 = prepareRelease({ shareEnvelope: A.shares[0], examinerKeys: cast.ex[0].seal, examinerIndex: 0, examId: EXAM_ID, centreId: CENTRE_A, epoch: board.epoch(GA), invigilators: board.recipients(GA) });
const r0Members = board.recipients(GA);
// … the board removes invigilator A2 (epoch 2) …
board.remove(GA, i2.evm);
// … examiner 2 releases at epoch 2 (i1 only)
const r2 = prepareRelease({ shareEnvelope: A.shares[2], examinerKeys: cast.ex[2].seal, examinerIndex: 2, examId: EXAM_ID, centreId: CENTRE_A, epoch: board.epoch(GA), invigilators: board.recipients(GA) });
const released = [{ blob: r0.blob, epoch: 1n }, { blob: r2.blob, epoch: 2n }];

describe("flow: release and open", () => {
  it("a current invigilator opens the paper and it is authentic (matches the on-chain commitment)", async () => {
    const res = await openPaper({ released, invigilatorKeys: i1.seal, examId: EXAM_ID, centreId: CENTRE_A, cipher: A.cipher, commitment: A.commitment });
    expect(res.authentic).toBe(true);
    const committee = openCommitteeBundle({ envelope: setup.committeeEnvelope, keys: cast.board.seal, examId: EXAM_ID });
    expect(res.text).toBe(committee.copies.centres[CENTRE_A].text);
  });

  it("the removed invigilator cannot open the release made after removal (NOT_A_MEMBER)", async () => {
    await expect(openPaper({ released, invigilatorKeys: i2.seal, examId: EXAM_ID, centreId: CENTRE_A, cipher: A.cipher, commitment: A.commitment })).rejects.toThrow(/NOT_A_MEMBER/);
  });

  it("another centre's invigilator and the examiners cannot open releases", async () => {
    for (const k of [i3.seal, cast.ex[0].seal, cast.ex[1].seal]) {
      await expect(openPaper({ released, invigilatorKeys: k, examId: EXAM_ID, centreId: CENTRE_A, cipher: A.cipher, commitment: A.commitment })).rejects.toThrow(/NOT_A_MEMBER/);
    }
  });

  it("one released share alone, or the same examiner twice, is not enough", async () => {
    await expect(openPaper({ released: released.slice(0, 1), invigilatorKeys: i1.seal, examId: EXAM_ID, centreId: CENTRE_A, cipher: A.cipher, commitment: A.commitment })).rejects.toThrow(/two released shares/);
    const again = prepareRelease({ shareEnvelope: A.shares[2], examinerKeys: cast.ex[2].seal, examinerIndex: 2, examId: EXAM_ID, centreId: CENTRE_A, epoch: 2n, invigilators: board.recipients(GA) });
    await expect(openPaper({ released: [released[1], { blob: again.blob, epoch: 2n }], invigilatorKeys: i1.seal, examId: EXAM_ID, centreId: CENTRE_A, cipher: A.cipher, commitment: A.commitment })).rejects.toThrow(/same examiner/);
  });

  it("a release is bound to its epoch (wrong epoch in the aad fails)", async () => {
    await expect(openPaper({ released: [{ blob: r0.blob, epoch: 2n }, released[1]], invigilatorKeys: i1.seal, examId: EXAM_ID, centreId: CENTRE_A, cipher: A.cipher, commitment: A.commitment })).rejects.toThrow();
  });

  it("a tampered copy or a wrong commitment fails with COMMITMENT_MISMATCH", async () => {
    const bad = A.cipher.slice(); bad[100] ^= 1;
    await expect(openPaper({ released, invigilatorKeys: i1.seal, examId: EXAM_ID, centreId: CENTRE_A, cipher: bad, commitment: A.commitment })).rejects.toMatchObject({ code: "COMMITMENT_MISMATCH" });
    await expect(openPaper({ released, invigilatorKeys: i1.seal, examId: EXAM_ID, centreId: CENTRE_A, cipher: A.cipher, commitment: setup.centres[1].commitment })).rejects.toMatchObject({ code: "COMMITMENT_MISMATCH" });
  });

  it("the API can check who a release was sealed to", () => {
    expect(releaseRecipientsMatch(r0.blob, r0Members)).toBe(true);
    expect(releaseRecipientsMatch(r2.blob, board.recipients(GA))).toBe(true);
    expect(releaseRecipientsMatch(r2.blob, r0Members)).toBe(false); // sealed after A2's removal
    expect(releaseRecipientsMatch(r0.blob, [i1.recipient])).toBe(false);
  });
});

describe("flow: scripts and leak tracing", () => {
  it("scripts sealed to markers open for markers; a leaked excerpt names centre A", async () => {
    const ps = newPseudonym();
    const s = sealScript({ examId: EXAM_ID, centreId: CENTRE_A, pseudonym: ps, answers: { q1: 2 }, markers: cast.markers.map((m) => m.recipient) });
    expect(openScript({ envelope: s.envelope, keys: cast.markers[1].seal, examId: EXAM_ID, centreId: CENTRE_A, pseudonymHash: s.pseudonymHash }).answers).toEqual({ q1: 2 });

    const { text } = await openPaper({ released, invigilatorKeys: i1.seal, examId: EXAM_ID, centreId: CENTRE_A, cipher: A.cipher, commitment: A.commitment });
    const excerpt = text.split(/\n(?=Q\d+:)/).filter((b) => /^Q\d+:/.test(b)).slice(2, 5).join("\n").toUpperCase();
    const committee = openCommitteeBundle({ envelope: setup.committeeEnvelope, keys: cast.ex[1].seal, examId: EXAM_ID });
    const m = matchLeak(excerpt, committee.paper, committee.tables);
    expect(m.copy).toBe(CENTRE_A);
  });
});
