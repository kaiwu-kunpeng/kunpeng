import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalStore, UNASSIGNED_GOAL_ID, goalBucket, goalProgress, goalsDir, isGoalId } from "../../src/goals/store.js";
import { parseGoalId } from "../../src/goals/parse.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-goals-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Goal 对象与存储（作者锁定）", () => {
  it("id 规则、未归属桶、进度计算", () => {
    expect(isGoalId("goal-seo-q1")).toBe(true);
    expect(isGoalId("goal-")).toBe(false);
    expect(isGoalId("Goal-x")).toBe(false);
    expect(isGoalId(undefined)).toBe(false);
    expect(UNASSIGNED_GOAL_ID).toBe("未归属");
    expect(goalBucket({})).toBe("未归属");
    expect(goalBucket({ goalId: "goal-a1" })).toBe("goal-a1");
    expect(goalBucket({ goalId: "bogus" })).toBe("未归属");
    const base = { id: "goal-x", product: "p", statement: "s", owner: "o", status: "active" as const, windowStart: 1, createdAt: 1, updatedAt: 1, history: [] };
    expect(goalProgress(base)).toBeUndefined();
    expect(goalProgress({ ...base, metric: { key: "k", label: "l", target: 100, direction: "up", current: 25 } })).toBe(0.25);
    expect(goalProgress({ ...base, metric: { key: "k", label: "l", target: 10, direction: "down", current: 40 } })).toBe(0.25);
    expect(goalProgress({ ...base, metric: { key: "k", label: "l", target: 10, direction: "down", current: 0 } })).toBe(1);
  });

  it("create/list/read/setStatus/setCurrent/appendHistory，原子落盘，坏文件跳过", async () => {
    const store = new GoalStore(goalsDir(join(dir, ".kunpeng")), () => 1_700_000_000_000);
    const g = await store.create({ product: "proj-b", statement: "SEO 内链：收录数 +30%", metric: { key: "indexed", label: "收录数", target: 130, direction: "up" }, budgetUsd: 50 });
    expect(g.id).toBe("goal-seo-30");
    expect(g.status).toBe("active");
    expect(g.owner).toBe("owner");
    expect(g.windowStart).toBe(1_700_000_000_000);
    expect(g.history).toEqual([{ at: 1_700_000_000_000, by: "owner", note: "created" }]);
    expect(existsSync(join(dir, ".kunpeng", "goals", "goal-seo-30.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, ".kunpeng", "goals", "goal-seo-30.json"), "utf8")).product).toBe("proj-b");

    await expect(store.create({ id: "goal-seo-30", product: "p", statement: "dup" })).rejects.toThrow(/已存在/);
    await expect(store.create({ id: "bad id", product: "p", statement: "x" })).rejects.toThrow();
    const explicit = await store.create({ id: "goal-c-answers", product: "proj-c", statement: "答案层不沉默", owner: "xp", by: "xp" });
    expect(explicit.history[0]!.by).toBe("xp");

    writeFileSync(join(dir, ".kunpeng", "goals", "broken.json"), "{nope", "utf8");
    expect((await store.list()).map((x) => x.id)).toEqual(["goal-seo-30", "goal-c-answers"]);
    expect(await store.read("goal-none")).toBeNull();

    expect((await store.setStatus("goal-seo-30", "paused", "xp"))?.status).toBe("paused");
    expect(await store.setStatus("goal-none", "done")).toBeNull();
    const cur = await store.setCurrent("goal-seo-30", 65, "bot");
    expect(cur?.metric?.current).toBe(65);
    expect(goalProgress(cur!)).toBe(0.5);
    await expect(store.setCurrent("goal-c-answers", 1)).rejects.toThrow(/没有指标/);
    await store.appendHistory("goal-seo-30", "周报：内链 +12", "weekly");
    const after = (await store.read("goal-seo-30"))!;
    expect(after.history.map((h) => h.note)).toEqual(["created", "status → paused", "current=65", "周报：内链 +12"]);
    expect(after.history.at(-1)?.by).toBe("weekly");
  });

  it("parseGoalId：粗体标签或 goal: 行，非法 id 跳过", () => {
    expect(parseGoalId("# 标题\n\n**目标**：goal-seo-30\n\n正文")).toBe("goal-seo-30");
    expect(parseGoalId("# 标题\n**目标** goal-c-answers\n")).toBe("goal-c-answers");
    expect(parseGoalId("goal: goal-abc\n")).toBe("goal-abc");
    expect(parseGoalId("Goal：goal-abc\n")).toBe("goal-abc");
    expect(parseGoalId("**目标**：Goal-Bad\ngoal: goal-ok")).toBe("goal-ok");
    expect(parseGoalId("没有目标行")).toBeUndefined();
  });
});