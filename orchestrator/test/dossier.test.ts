import { describe, it, expect } from "vitest";
import { renderAutoBlock, upsertDossier, DOSSIER_AUTO_START, DOSSIER_AUTO_END } from "../src/dossier/dossier.js";

const input = {
  projectName: "demo",
  flows: [
    { flowId: "f1", status: "verified", stage: "done", updatedAt: 100 },
    { flowId: "f2", status: "rolled-back", stage: "verify", updatedAt: 200 },
    { flowId: "f3", status: "running", stage: "implement", updatedAt: 300 },
  ],
  now: 1000,
};

describe("renderAutoBlock", () => {
  it("含标记 + 统计 + 成功率(verified/(verified+rolledBack))", () => {
    const b = renderAutoBlock(input);
    expect(b).toContain(DOSSIER_AUTO_START);
    expect(b).toContain(DOSSIER_AUTO_END);
    expect(b).toContain("累计流: **3**");
    expect(b).toContain("verified: **1**");
    expect(b).toContain("回滚: **1**");
    expect(b).toContain("运行中: **1**");
    expect(b).toContain("成功率: **50%**");
  });

  it("最近流按 updatedAt 降序", () => {
    const b = renderAutoBlock(input);
    expect(b.indexOf("f3")).toBeLessThan(b.indexOf("f2"));
    expect(b.indexOf("f2")).toBeLessThan(b.indexOf("f1"));
  });

  it("无流时成功率 100% 且占位", () => {
    const b = renderAutoBlock({ projectName: "x", flows: [], now: 1 });
    expect(b).toContain("成功率: **100%**");
    expect(b).toContain("暂无流记录");
  });
});

describe("upsertDossier", () => {
  it("existing 为空 → 输出骨架(含人写区占位 + 机器区)", () => {
    const out = upsertDossier(null, input);
    expect(out).toContain("# demo · 项目档案");
    expect(out).toContain("北极星 / 目标");
    expect(out).toContain("Roadmap");
    expect(out).toContain(DOSSIER_AUTO_START);
  });

  it("保留人写区,只替换机器区", () => {
    const human = "# 我的项目\n\n## 北极星 / 目标\n\n月活破百万\n\n";
    const first = human + renderAutoBlock({ ...input, flows: [] });
    const updated = upsertDossier(first, input);
    expect(updated).toContain("月活破百万");
    expect(updated).toContain("累计流: **3**");
    expect(updated).not.toContain("累计流: **0**");
  });

  it("幂等:同输入跑两次结果完全相同", () => {
    const a = upsertDossier(null, input);
    const b = upsertDossier(a, input);
    const c = upsertDossier(b, input);
    expect(b).toBe(c);
  });
});
