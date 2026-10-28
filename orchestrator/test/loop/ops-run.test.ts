import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cadenceMs, duePlaybooks, diffOpsGotchas } from "../../src/loop/ops-run.js";
import { createOpsGate, listOpsGates, decideOpsGate } from "../../src/loop/ops-gate.js";
import type { PlaybookDef } from "../../src/loop/playbook.js";

function pb(over: Partial<PlaybookDef>): PlaybookDef {
  return { id: "p", title: "p", sections: {}, body: "", ...over } as PlaybookDef;
}

describe("ops 触发判定", () => {
  it("cadence 映射：daily/weekly/monthly，缺省按 weekly", () => {
    expect(cadenceMs("daily")).toBe(86400000);
    expect(cadenceMs("weekly")).toBe(604800000);
    expect(cadenceMs("monthly")).toBe(2592000000);
    expect(cadenceMs(undefined)).toBe(604800000);
    expect(cadenceMs("乱写")).toBe(604800000);
  });

  it("duePlaybooks：从未跑过=到期；周期内=不到期；无 loopId=不到期", () => {
    const now = 10 * 86400000;
    const a = pb({ id: "a", loopId: "loop-a", cadence: "daily" });
    const b = pb({ id: "b", loopId: "loop-b", cadence: "weekly" });
    const c = pb({ id: "c" });
    const due = duePlaybooks([a, b, c], { "loop-a": now - 2 * 86400000, "loop-b": now - 86400000 }, now);
    expect(due.map((p) => p.id)).toEqual(["a"]);
    expect(duePlaybooks([b], {}, now).map((p) => p.id)).toEqual(["b"]);
  });

  it("diffOpsGotchas 三态", () => {
    const d = diffOpsGotchas(["甲", "乙"], ["乙", "丙"]);
    expect(d.added).toEqual(["丙"]);
    expect(d.resolved).toEqual(["甲"]);
    expect(d.persisted).toEqual(["乙"]);
  });
});

describe("ops-gate 存储", () => {
  it("create→list→decide 回环，幂等与只决一次", async () => {
    const root = await mkdtemp(join(tmpdir(), "opsgate-"));
    const e1 = await createOpsGate(root, { projectId: "pj", playbookId: "pb1", loopId: "l1", reason: "review 门" }, 1000);
    expect(e1.status).toBe("pending");
    const e2 = await createOpsGate(root, { projectId: "pj", playbookId: "pb1", loopId: "l1", reason: "重复" }, 2000);
    expect(e2.id).toBe(e1.id);
    expect(await listOpsGates(root)).toHaveLength(1);
    const decided = await decideOpsGate(root, e1.id, "approved", { by: "human", via: "test" }, 3000);
    expect(decided?.decidedBy).toEqual({ by: "human", via: "test" });
    expect(decided?.status).toBe("approved");
    expect(decided?.decidedAt).toBe(3000);
    expect(await decideOpsGate(root, e1.id, "rejected", { by: "human", via: "test" })).toBeNull();
    expect(await listOpsGates(root)).toHaveLength(0 + 1);
  });

  it("空目录返回 []", async () => {
    const root = await mkdtemp(join(tmpdir(), "opsgate-empty-"));
    expect(await listOpsGates(root)).toEqual([]);
  });
});