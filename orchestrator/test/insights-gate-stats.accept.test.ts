import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src", "server", "ui", "views", "insights.ts"), "utf8");

describe("质量门战绩仪表(作者验收)", () => {
  it("面板与三类指标在位", () => {
    expect(src).toContain("insights-gates");
    expect(src.includes("verified") || src.includes("Verified")).toBe(true);
    expect(src).toContain("clusterFailures");
    expect(src).toContain("readRecentFailureItems");
  });
  it("空态与口径说明", () => {
    expect(src.includes("暂无数据") || src.includes("\\u6682\\u65E0\\u6570\\u636E")).toBe(true);
    expect(src.includes("近7天") || src.includes("近 7 天")).toBe(true);
  });
});