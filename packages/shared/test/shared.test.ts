import { describe, expect, it } from "vitest";
import { CONTRACT_ERROR_CODES, CreateExamBody, ERRORS, PAPERTRAIL_ABI, errorMessage, mldsaSignature } from "../src/index.js";

describe("shared", () => {
  it("error copy fills placeholders", () => {
    expect(errorMessage("TOO_EARLY", { startTime: "09:00 UTC" })).toBe("This paper is still sealed. It can be released from 09:00 UTC.");
    expect(ERRORS.COMMITMENT_MISMATCH.status).toBe(422);
  });
  it("every contract error code maps to a catalog entry and exists in the ABI", () => {
    const abiErrors = new Set<string>(PAPERTRAIL_ABI.filter((x) => x.type === "error").map((x) => x.name));
    for (const [name, code] of Object.entries(CONTRACT_ERROR_CODES)) {
      expect(abiErrors.has(name)).toBe(true);
      expect(ERRORS[code]).toBeDefined();
    }
  });
  it("schemas reject malformed bodies", () => {
    expect(mldsaSignature.safeParse("0x" + "ab".repeat(4627)).success).toBe(true);
    expect(mldsaSignature.safeParse("0x" + "ab".repeat(4626)).success).toBe(false);
    expect(CreateExamBody.safeParse({ title: "x" }).success).toBe(false);
  });
});
