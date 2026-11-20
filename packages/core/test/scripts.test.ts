import { describe, expect, it } from "vitest";
import { newPseudonym, openIdentityMap, openScript, pseudonymHash, sealIdentityMap, sealScript } from "../src/scripts.js";
import { CENTRE_A, CENTRE_B, EXAM_ID, cast } from "./fixtures.js";

describe("scripts", () => {
  const ps = newPseudonym();
  const s = sealScript({ examId: EXAM_ID, centreId: CENTRE_A, pseudonym: ps, answers: { q1: 0, q2: 3 }, markers: cast.markers.map((m) => m.recipient) });
  it("markers open the script and see only the pseudonym", () => {
    for (const m of cast.markers) expect(openScript({ envelope: s.envelope, keys: m.seal, examId: EXAM_ID, centreId: CENTRE_A, pseudonymHash: s.pseudonymHash })).toEqual({ v: 1, pseudonym: ps, answers: { q1: 0, q2: 3 } });
    expect(s.pseudonymHash).toBe(pseudonymHash(EXAM_ID, ps));
  });
  it("non-markers, another centre or another pseudonym are refused", () => {
    expect(() => openScript({ envelope: s.envelope, keys: cast.inv[0].seal, examId: EXAM_ID, centreId: CENTRE_A, pseudonymHash: s.pseudonymHash })).toThrow();
    expect(() => openScript({ envelope: s.envelope, keys: cast.markers[0].seal, examId: EXAM_ID, centreId: CENTRE_B, pseudonymHash: s.pseudonymHash })).toThrow();
    expect(() => openScript({ envelope: s.envelope, keys: cast.markers[0].seal, examId: EXAM_ID, centreId: CENTRE_A, pseudonymHash: pseudonymHash(EXAM_ID, newPseudonym()) })).toThrow();
  });
  it("the identity map opens for the board only", () => {
    const env = sealIdentityMap({ examId: EXAM_ID, map: { [ps]: "candidate-17" }, board: cast.board.recipient });
    expect(openIdentityMap({ examId: EXAM_ID, envelope: env, keys: cast.board.seal })).toEqual({ [ps]: "candidate-17" });
    expect(() => openIdentityMap({ examId: EXAM_ID, envelope: env, keys: cast.markers[0].seal })).toThrow();
  });
});
