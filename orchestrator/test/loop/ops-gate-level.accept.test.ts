import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createOpsGate, listOpsGates, maxLeverLevel } from "../../src/loop/ops-gate.js";
import { aggregateReviewQueue, type ProjectSnapshot } from "../../src/server/state.js";

function snapWithGate(level?: string): ProjectSnapshot {
  return {
    id: "p", name: "p",
    state: {
      humanGates: [], flows: [], blockers: [], health: { alerts: [], running: 0, healthy: 0 },
      opsGates: [{ id: "og", projectId: "p", playbookId: "pb", loopId: "lp", reason: "r", status: "pending", createdAt: 1, ...(level ? { level } : {}) }],
    },
  } as unknown as ProjectSnapshot;
}
const levelOf = (level?: string) => aggregateReviewQueue([snapWithGate(level)], { now: 10 }).find((i) => i.id === "og")?.decision?.blastRadius;

describe("运营门等级取自 loop 杠杆（作者锁定）", () => {
  test("maxLeverLevel：取最高等级；都没声明 → undefined", () => {
    expect(maxLeverLevel([{ level: "L0" }, { level: "L3" }, {}, { level: "L1" }])).toBe("L3");
    expect(maxLeverLevel([{ level: "L4" }, { level: "L2" }])).toBe("L4");
    expect(maxLeverLevel([{}, {}])).toBeUndefined();
    expect(maxLeverLevel(undefined)).toBeUndefined();
  });

  test("createOpsGate 落盘等级；没给等级就不写该键", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-opsgate-level-"));
    try {
      await createOpsGate(repo, { projectId: "p", playbookId: "pb-a", loopId: "lp", reason: "r", level: "L3" }, 1000);
      await createOpsGate(repo, { projectId: "p", playbookId: "pb-b", loopId: "lp", reason: "r" }, 2000);
      const gates = await listOpsGates(repo);
      expect(gates.find((g) => g.playbookId === "pb-a")?.level).toBe("L3");
      expect(gates.find((g) => g.playbookId === "pb-b")).not.toHaveProperty("level");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("收件箱用门上的等级（单一来源），不再写死 L2；旧门缺等级按 L3", () => {
    expect(levelOf("L1")).toBe("L1");
    expect(levelOf("L4")).toBe("L4");
    expect(levelOf(undefined)).toBe("L3");
    expect(levelOf("L9")).toBe("L3");
  });

  test("ops 命令创建门时按该 loop 杠杆算等级（源码形状）", () => {
    const src = readFileSync(new URL("../../src/cli-commands/ops.ts", import.meta.url), "utf8");
    expect(src).toMatch(/maxLeverLevel\(\s*loops\.find\(/);
    expect(src).toMatch(/createOpsGate\([\s\S]*?level[\s\S]*?\)/);
    const agg = readFileSync(new URL("../../src/server/state-snapshot-aggregates.ts", import.meta.url), "utf8");
    expect(agg).not.toMatch(/ops-gate-approve", blastRadius: "L2"/);
  });
});