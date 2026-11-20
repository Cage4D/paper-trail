import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index";

describe("@paper-trail/core placeholder", () => {
  it("loads", () => {
    expect(PACKAGE_NAME).toBe("@paper-trail/core");
  });
});
