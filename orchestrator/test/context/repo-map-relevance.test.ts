import { describe, it, expect } from "vitest";
import { queryRelevant } from "../../src/context/repo-map.js";

const files = [
  { path: "a/escape-rate.ts", source: "export function computeEscapeRate() {}" },
  { path: "a/hot.ts", source: "export const h = 1;" },
];

describe("queryRelevant v2 路径+模糊匹配", () => {
  it("路径词命中文件路径 → 加分", () => {
    const r = queryRelevant(files, ["escape-rate"]);
    const er = r.find((x) => x.path === "a/escape-rate.ts")!;
    expect(er.relevance).toBeGreaterThanOrEqual(1);
    expect(r[0].path).toBe("a/escape-rate.ts");
  });
  it("子串模糊：新函数名含现有导出名 → 加分", () => {
    const r = queryRelevant(files, ["computeEscapeRateByWindow"]);
    const er = r.find((x) => x.path === "a/escape-rate.ts")!;
    expect(er.relevance).toBeGreaterThanOrEqual(1);
  });
  it("不相关词 → 0", () => {
    const r = queryRelevant(files, ["zzzz"]);
    expect(r.every((x) => x.relevance === 0)).toBe(true);
  });
});
