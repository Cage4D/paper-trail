import { readFileSync } from "node:fs";
import { createRoleKey, type RoleKey } from "../src/keys.js";
import type { Participant } from "../src/split.js";

export const SAMPLE = readFileSync(new URL("../fixtures/sample-paper.md", import.meta.url), "utf8");
export const EXAM_ID = `0x${"ab".repeat(32)}` as const;
export const CENTRE_A = `0x${"0a".repeat(32)}` as const;
export const CENTRE_B = `0x${"0b".repeat(32)}` as const;
export const part = (k: RoleKey): Participant => ({ address: k.evm, recipient: k.recipient });

/** One cast for every test file: board, 3 examiners, 3 invigilators, 2 markers. */
export const cast = {
  board: createRoleKey(),
  ex: [createRoleKey(), createRoleKey(), createRoleKey()] as const,
  inv: [createRoleKey(), createRoleKey(), createRoleKey()] as const,
  markers: [createRoleKey(), createRoleKey()] as const,
};
