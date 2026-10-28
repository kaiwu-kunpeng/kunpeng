import { describe, it, expect } from "vitest";
import { buildArchitectureGraph, ARCH_MODULE_IDS } from "../../src/server/ui/views/architecture-graph.js";
import { MODULE_REGISTRY } from "../../src/status/module-registry.js";
import type { DashboardState } from "../../src/server/state.js";

function base(): DashboardState {
  return {} as unknown as DashboardState;
}

function withModules(mods: Array<{ id: string; light: string }>): DashboardState {
  const s = base() as unknown as Record<string, unknown>;
  s.moduleStatus = { modules: mods };
  return s as unknown as DashboardState;
}

describe("架构图 × MODULE_REGISTRY 真相源", () => {
  it("映射表里的模块 id 必须真实存在于 MODULE_REGISTRY（防双表漂移）", () => {
    const registryIds = new Set(MODULE_REGISTRY.map((m) => m.id));
    for (const [nodeId, moduleId] of Object.entries(ARCH_MODULE_IDS)) {
      expect(registryIds.has(moduleId), `节点 ${nodeId} 映射的模块 ${moduleId} 不在注册表`).toBe(true);
    }
    expect(Object.keys(ARCH_MODULE_IDS).length).toBeGreaterThanOrEqual(8);
  });

  it("模块红灯 → 映射节点 state=failed 且 metric 带标注", () => {
    const g = buildArchitectureGraph(withModules([{ id: "merge-gate", light: "red" }]));
    const gate1 = g.nodes.find((n) => n.id === "gate1");
    expect(gate1?.state).toBe("failed");
    expect(String(gate1?.metric ?? "")).toContain("模块红");
  });

  it("模块黄灯 → state 不动只标注 metric；绿灯/缺 moduleStatus → 与现状一致", () => {
    const gY = buildArchitectureGraph(withModules([{ id: "patrol", light: "yellow" }]));
    const patrolY = gY.nodes.find((n) => n.id === "patrol");
    expect(patrolY?.state).not.toBe("failed");
    expect(String(patrolY?.metric ?? "")).toContain("模块黄");

    const gGreen = buildArchitectureGraph(withModules([{ id: "patrol", light: "green" }]));
    const gNone = buildArchitectureGraph(base());
    const pG = gGreen.nodes.find((n) => n.id === "patrol");
    const pN = gNone.nodes.find((n) => n.id === "patrol");
    expect(String(pG?.metric ?? "")).not.toContain("模块");
    expect(pG?.state).toBe(pN?.state);
  });
});