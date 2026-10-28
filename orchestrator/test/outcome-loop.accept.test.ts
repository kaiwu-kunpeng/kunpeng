import { describe, expect, it } from "vitest";
import { shouldDeprecate } from "../src/skills/registry.js";

describe("战绩闭环(作者验收)", () => {
  it("退役规则:n≥5 且胜率<20%", () => {
    expect(shouldDeprecate({ wins: 0, losses: 5 })).toBe(true);
    expect(shouldDeprecate({ wins: 1, losses: 5 })).toBe(true);
    expect(shouldDeprecate({ wins: 1, losses: 4 })).toBe(false);
    expect(shouldDeprecate({ wins: 0, losses: 4 })).toBe(false);
    expect(shouldDeprecate({ wins: 3, losses: 2 })).toBe(false);
    expect(shouldDeprecate({})).toBe(false);
  });
});