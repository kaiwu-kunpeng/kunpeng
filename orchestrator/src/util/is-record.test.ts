import { describe, it, expect } from "vitest";
import { isRecord } from "./is-record.js";

describe("isRecord", () => {
  it("普通对象为真", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });
  it("null / 数组 / 原始值为假", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });
});