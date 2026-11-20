import { describe, expect, it } from "vitest";
import { BoardGroups, centreGroupKey, membersHash, openGroupEpoch } from "../src/groups.js";
import { CENTRE_A, cast } from "./fixtures.js";

const G = centreGroupKey(CENTRE_A);
const [i1, i2, i3] = cast.inv;

describe("groups: centre epoch groups", () => {
  it("create gives one epoch for the first members; members open it", () => {
    const bg = new BoardGroups();
    const r = bg.create(G, { [i1.evm]: i1.recipient, [i2.evm]: i2.recipient });
    expect(r.epoch).toBe(1n);
    expect(r.membersHash).toBe(membersHash([i2.evm, i1.evm]));
    expect(openGroupEpoch({ groupKey: G, envelope: r.envelope!, keys: i1.seal }).epoch).toBe(1n);
  });

  it("a removed invigilator cannot open any later epoch (NOT_A_MEMBER), the others can", () => {
    const bg = new BoardGroups();
    bg.create(G, { [i1.evm]: i1.recipient, [i2.evm]: i2.recipient, [i3.evm]: i3.recipient });
    const removed = bg.remove(G, i2.evm);
    const rotated = bg.rotate(G);
    const added = bg.add(G, cast.markers[0].evm, cast.markers[0].recipient);
    for (const r of [removed, rotated, added]) {
      expect(() => openGroupEpoch({ groupKey: G, envelope: r.envelope!, keys: i2.seal })).toThrow(/NOT_A_MEMBER/);
      expect(openGroupEpoch({ groupKey: G, envelope: r.envelope!, keys: i1.seal }).epoch).toBe(r.epoch);
    }
    expect(added.epoch).toBe(4n);
    // a new member cannot open earlier epochs
    expect(() => openGroupEpoch({ groupKey: G, envelope: removed.envelope!, keys: cast.markers[0].seal })).toThrow(/NOT_A_MEMBER/);
  });

  it("board state round-trips through its sealed export (history + members)", () => {
    const bg = new BoardGroups();
    bg.create(G, { [i1.evm]: i1.recipient, [i2.evm]: i2.recipient });
    bg.remove(G, i2.evm);
    const key = bg.currentKey(G);
    const sealed = bg.exportSealed(cast.board.recipient);
    expect(() => BoardGroups.restoreSealed(sealed, i1.seal)).toThrow();
    const back = BoardGroups.restoreSealed(sealed, cast.board.seal);
    expect(back.epoch(G)).toBe(2n);
    expect(Buffer.from(back.currentKey(G).key).equals(Buffer.from(key.key))).toBe(true);
    expect(back.members(G)).toEqual([i1.evm]);
    const r = back.rotate(G); // continues after restore
    expect(r.epoch).toBe(3n);
    expect(() => openGroupEpoch({ groupKey: G, envelope: r.envelope!, keys: i2.seal })).toThrow(/NOT_A_MEMBER/);
  });

  it("rejects group keys outside QoreSeal's label rule", () => {
    expect(() => new BoardGroups().create("centre:A|B", {})).toThrow(/invalid QoreSeal/);
  });
});
