import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalStore, goalsDir } from "../../src/goals/store.js";
import { collectGoals, loopViewFrom } from "../../src/server/state-collect/dashboard.js";
import type { LoopDef } from "../../src/loop/types.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-goals-collect-")); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe("仪表盘快照带 goals、LoopView 带 goalId（作者锁定）", () => {
  it("collectGoals：无目录 → []；建一个目标后映射成 {id, owner, statement, status}", async () => {
    expect(await collectGoals(repo)).toEqual([]);
    const store = new GoalStore(goalsDir(join(repo, ".kunpeng")));
    await store.create({ id: "goal-links", product: "pz", statement: "internal links", owner: "alice" });
    expect(await collectGoals(repo)).toEqual([{ id: "goal-links", owner: "alice", statement: "internal links", status: "active" }]);
  });

  it("loopViewFrom 透传 goalId；没有 goalId 时不出现该键", () => {
    const base: LoopDef = {
      id: "pz-links", name: "内链", projectId: "pz", recipe: "seo-internal-links",
      metric: { key: "linkDefects", label: "缺陷", current: 1 },
      levers: [{ id: "crawl", label: "抓", status: "active" }],
      waves: [], createdAt: 1, updatedAt: 1,
    };
    expect(loopViewFrom({ ...base, goalId: "goal-links" }, 10).goalId).toBe("goal-links");
    expect("goalId" in loopViewFrom(base, 10)).toBe(false);
  });
});