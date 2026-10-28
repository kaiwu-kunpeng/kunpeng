import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("四条 artifact 裁决路由署名（作者锁定）", () => {
  it("approve/reject/approve-connector/confirm-release 都调 recordArtifactDecision 并带当前用户", () => {
    const src = readFileSync(new URL("../../src/server/routes/gate-actions.ts", import.meta.url), "utf8");
    expect((src.match(/recordArtifactDecision\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(src).toContain("currentUsername()");
    expect(src).toContain('"decisions.jsonl"');
    for (const path of ["/api/approve-connector", "/api/approve", "/api/confirm-release", "/api/reject"]) {
      const at = src.indexOf(`path: "${path}"`);
      expect(at, path).toBeGreaterThan(-1);
      expect(src.slice(at, at + 1800)).toContain("recordArtifactDecision(");
    }
  });

  it("ReviewItem 类型带 decision 与 ops-gate kind", () => {
    const types = readFileSync(new URL("../../src/server/state-types.ts", import.meta.url), "utf8");
    expect(types).toContain("export interface ReviewDecision");
    expect(types).toContain("decision?: ReviewDecision");
    expect(types).toContain('"ops-gate"');
  });
});