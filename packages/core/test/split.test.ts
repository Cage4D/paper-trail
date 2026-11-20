import { describe, expect, it } from "vitest";
import { gcm } from "@noble/ciphers/aes.js";
import { combine } from "shamir-secret-sharing";
import { _cipherAad, openCommitteeBundle, openShare, setExam } from "../src/split.js";
import { CENTRE_A, CENTRE_B, EXAM_ID, SAMPLE, cast, part } from "./fixtures.js";
import { commitmentOf } from "../src/paper.js";
import { sha3Hex } from "../src/util.js";

const setup = await setExam({ paperMarkdown: SAMPLE, examId: EXAM_ID, examiners: [part(cast.ex[0]), part(cast.ex[1]), part(cast.ex[2])], board: part(cast.board), centreIds: [CENTRE_A, CENTRE_B] });
const decrypt = (kc: Uint8Array, cipher: Uint8Array, centreId: string, commitment: string) => gcm(kc, cipher.slice(0, 12), _cipherAad(EXAM_ID, centreId, commitment)).decrypt(cipher.slice(12));

describe("split: setExam", () => {
  it("publishes only ciphertexts, envelopes and hashes", () => {
    expect(setup.centres).toHaveLength(2);
    for (const c of setup.centres) {
      expect(c.cipherHash).toBe(sha3Hex(c.cipher));
      expect(new TextDecoder().decode(c.cipher)).not.toMatch(/newtons|photosynthesis/i);
    }
    expect(setup.committeeBundleHash).toBe(sha3Hex(setup.committeeEnvelope));
  });

  it("every committee member (3 examiners + board) re-derives the same copies", () => {
    for (const k of [...cast.ex, cast.board]) {
      const b = openCommitteeBundle({ envelope: setup.committeeEnvelope, keys: k.seal, examId: EXAM_ID });
      expect(b.copies.master.commitment).toBe(setup.masterCommitment);
      expect(b.copies.centres[CENTRE_A].commitment).toBe(setup.centres[0].commitment);
    }
    expect(() => openCommitteeBundle({ envelope: setup.committeeEnvelope, keys: cast.inv[0].seal, examId: EXAM_ID })).toThrow();
  });

  it("each share opens only for its own examiner", () => {
    const c = setup.centres[0];
    expect(openShare({ envelope: c.shares[1], keys: cast.ex[1].seal, examId: EXAM_ID, centreId: CENTRE_A, examinerIndex: 1 }).length).toBeGreaterThan(32);
    expect(() => openShare({ envelope: c.shares[1], keys: cast.ex[0].seal, examId: EXAM_ID, centreId: CENTRE_A, examinerIndex: 1 })).toThrow();
    // bound to its centre via aad
    expect(() => openShare({ envelope: c.shares[1], keys: cast.ex[1].seal, examId: EXAM_ID, centreId: CENTRE_B, examinerIndex: 1 })).toThrow();
  });

  it("any two shares recover K_c and decrypt the variant, which matches its commitment", async () => {
    const c = setup.centres[0];
    const s = [0, 1, 2].map((i) => openShare({ envelope: c.shares[i], keys: cast.ex[i].seal, examId: EXAM_ID, centreId: CENTRE_A, examinerIndex: i }));
    for (const pair of [[0, 1], [0, 2], [1, 2]]) {
      const kc = await combine(pair.map((i) => s[i]));
      const text = new TextDecoder().decode(decrypt(kc, c.cipher, CENTRE_A, c.commitment));
      expect(commitmentOf(text)).toBe(c.commitment);
    }
  });

  it("one share alone cannot decrypt", async () => {
    const c = setup.centres[0];
    const s0 = openShare({ envelope: c.shares[0], keys: cast.ex[0].seal, examId: EXAM_ID, centreId: CENTRE_A, examinerIndex: 0 });
    const guess = await combine([s0, s0]).catch(() => new Uint8Array(32));
    expect(() => decrypt(guess, c.cipher, CENTRE_A, c.commitment)).toThrow();
  });

  it("a tampered ciphertext or a wrong commitment fails authentication", async () => {
    const c = setup.centres[0];
    const s = [0, 1].map((i) => openShare({ envelope: c.shares[i], keys: cast.ex[i].seal, examId: EXAM_ID, centreId: CENTRE_A, examinerIndex: i }));
    const kc = await combine(s);
    const bad = c.cipher.slice(); bad[40] ^= 1;
    expect(() => decrypt(kc, bad, CENTRE_A, c.commitment)).toThrow();
    expect(() => decrypt(kc, c.cipher, CENTRE_A, setup.centres[1].commitment)).toThrow();
  });
});
