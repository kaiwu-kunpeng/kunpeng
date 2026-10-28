import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAction, readActions, goalProgress } from "../src/loop/action-ledger.js";
import { LoopDefSchema } from "../src/loop/types.js";

const base: Parameters<typeof appendAction>[1] = {
  at: 1, loopId: "l1", projectId: "p1", recipe: "geo", lever: "expand",
  subject: "第1波", metricKey: "citations", metricAfter: 3, metricDelta: 1, verified: true,
};

describe("动作台账(作者验收)", () => {
  it("append/read 往返 + 过滤 + 排序", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-ledger-"));
    await appendAction(dir, { ...base, at: 5 });
    await appendAction(dir, { ...base, at: 2, loopId: "l2" });
    const all = await readActions(dir);
    expect(all.map((a) => a.at)).toEqual([2, 5]);
    expect((await readActions(dir, { loopId: "l2" })).length).toBe(1);
    expect((await readActions(dir, { since: 3 })).length).toBe(1);
  });

  it("坏行跳过、缺文件返回空", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-ledger2-"));
    expect(await readActions(dir)).toEqual([]);
    await mkdir(join(dir, "ops"), { recursive: true });
    await writeFile(join(dir, "ops", "actions.jsonl"), 'not-json\n' + JSON.stringify({ ...base, at: 9 }) + "\n");
    const rows = await readActions(dir);
    expect(rows.length).toBe(1);
    expect(rows[0].at).toBe(9);
  });

  it("goalProgress 上行/下行/除零", () => {
    expect(goalProgress(5, { target: 10 })).toBeCloseTo(0.5);
    expect(goalProgress(20, { target: 10 })).toBe(1);
    expect(goalProgress(20, { target: 10, direction: "down" })).toBeCloseTo(0.5);
    expect(goalProgress(5, { target: 10, direction: "down" })).toBe(1);
    expect(goalProgress(0, { target: 0 })).toBe(0);
  });

  it("LoopDefSchema 接受可选 goal 且旧定义不受影响", () => {
    const legacy = {
      id: "l", name: "n", projectId: "p", recipe: "geo",
      metric: { key: "k", label: "K", current: 1 },
      levers: [], waves: [], createdAt: 1, updatedAt: 1,
    };
    expect(LoopDefSchema.safeParse(legacy).success).toBe(true);
    expect(LoopDefSchema.safeParse({ ...legacy, goal: { target: 8, direction: "up" } }).success).toBe(true);
  });
});