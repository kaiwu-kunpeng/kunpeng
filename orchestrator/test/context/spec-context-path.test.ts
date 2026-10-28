import { describe, it, expect } from "vitest";
import { extractPathTerms, buildRepoMapContext } from "../../src/context/spec-context.js";

describe("extractPathTerms", () => {
  it("抽文件名词根+分段(小写去重)", () => {
    const t = extractPathTerms("给 src/metrics/escape-rate.ts 加 computeEscapeRateByWindow");
    expect(t).toContain("escape-rate");
    expect(t).toContain("escape");
    expect(t).toContain("rate");
  });
  it("无文件引用 → 空", () => {
    expect(extractPathTerms("随便说点啥 nothing here")).toEqual([]);
  });
});

describe("buildRepoMapContext 现在能命中按路径点名的目标文件", () => {
  const files = [
    { path: "a/escape-rate.ts", source: "export function computeEscapeRate() {}\nexport const k = 1;" },
    { path: "a/hot.ts", source: "export const h = 1;" },
    { path: "a/x.ts", source: "import './hot';\nimport './hot';\nexport const x = 1;" },
  ];
  it("点名 escape-rate.ts + 新函数名 → escape-rate.ts 进上下文且排在 hot 前", () => {
    const ctx = buildRepoMapContext(files, "给 a/escape-rate.ts 加 computeEscapeRateByWindow", { maxChars: 5000 });
    expect(ctx).toContain("escape-rate.ts");
    expect(ctx.indexOf("escape-rate.ts")).toBeLessThan(ctx.indexOf("hot.ts"));
  });
});
