import { describe, it, expect } from "vitest";
import { renderAutoBlock, upsertDossier, DOSSIER_AUTO_START, DOSSIER_AUTO_END } from "../../src/dossier/dossier.js";

const input = {
  projectName: "demo",
  now: 1000,
  flows: [
    { flowId: "f-verified", status: "verified", stage: "done", updatedAt: 300 },
    { flowId: "f-running", status: "running", stage: "implement", updatedAt: 200 },
    { flowId: "f-rolled", status: "rolled-back", stage: "done", updatedAt: 100 },
  ],
};

describe("dossier 变更归档段", () => {
  it("renderAutoBlock 含变更归档标题且在机器区内", () => {
    const block = renderAutoBlock(input);
    expect(block).toContain("## 变更归档");
    // 仍保留既有当前状态/流索引段
    expect(block).toContain("## 当前状态(自动)");
    expect(block).toContain("### 最近流索引(近 10 条)");
    // 归档段在 END 标记之前
    expect(block.indexOf("## 变更归档")).toBeLessThan(block.indexOf(DOSSIER_AUTO_END));
    expect(block.indexOf("## 变更归档")).toBeGreaterThan(block.indexOf("### 最近流索引(近 10 条)"));
  });

  it("flow 生命周期映射成血缘 stage", () => {
    const block = renderAutoBlock(input);
    expect(block).toContain("[archived] f-verified");
    expect(block).toContain("[proposed] f-running");
    expect(block).toContain("[applied] f-rolled");
  });

  it("upsert 幂等:同输入跑两次结果一致", () => {
    const first = upsertDossier(null, input);
    const second = upsertDossier(first, input);
    expect(second).toBe(first);
  });

  it("空流列表仍渲染变更归档占位,不崩", () => {
    const block = renderAutoBlock({ projectName: "demo", now: 1, flows: [] });
    expect(block).toContain("## 变更归档");
    expect(block).toContain("(暂无变更)");
    expect(block).toContain(DOSSIER_AUTO_START);
  });
});