import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";

const src = clientSource();

describe("上下文水位条(作者验收)", () => {
  it("估算函数与水位条在位", () => {
    expect(src).toContain("kpCtxEstimate");
    expect(src).toContain("kp-ctx-meter");
    expect(src).toContain("1000000");
  });
  it("70% 一次性提示与移交话术", () => {
    expect(src.includes("另开新会话") || src.includes("\\u53E6\\u5F00\\u65B0\\u4F1A\\u8BDD")).toBe(true);
    expect(src.includes("70%") || src.includes("0.7")).toBe(true);
  });
});
