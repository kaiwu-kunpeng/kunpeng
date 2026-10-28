import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../src/cli-commands/loop-core.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import type { CliContext } from "../../src/cli-commands/registry.js";
import { LoopDefSchema } from "../../src/loop/types.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-loop-reg-")); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

function ctx(rest: string[], goalArg?: string, flags: string[] = []): CliContext {
  return { repoRoot: repo, kunpengHome: repo, rest, argv: rest, flags: new Set(flags), ...(goalArg ? { goalArg } : {}) } as CliContext;
}

describe("kunpeng loop register 挂目标与抓手（作者锁定）", () => {
  it("--goal/--lever/--autonomous 写进 loop 定义且过 schema", async () => {
    const loop = listCliCommands().find((c) => c.name === "loop")!;
    await loop.run(ctx([
      "register", "--id", "pz-links", "--name", "PZ 内链", "--project", "proj-a", "--recipe", "seo-internal-links",
      "--metric-key", "linkDefects", "--metric-label", "内链缺陷", "--metric", "0",
      "--lever", "crawl=只读抓取=L0", "--lever", "submit-indexnow=提交收录=L3", "--autonomous",
    ], "goal-pz-links"));
    const raw = JSON.parse(readFileSync(join(repo, ".kunpeng", "loops", "pz-links.json"), "utf8"));
    const def = LoopDefSchema.parse(raw);
    expect(def.goalId).toBe("goal-pz-links");
    expect(def.autonomous).toBe(true);
    expect(def.levers).toEqual([
      { id: "crawl", label: "只读抓取", status: "active", level: "L0" },
      { id: "submit-indexnow", label: "提交收录", status: "active", level: "L3" },
    ]);
  });

  it("旧用法不变：不带新参数照常注册，levers 为空、无 goalId", async () => {
    const loop = listCliCommands().find((c) => c.name === "loop")!;
    await loop.run(ctx(["register", "--id", "plain", "--name", "P", "--project", "proj-a", "--recipe", "agent-playbook", "--metric-key", "k", "--metric-label", "l", "--metric", "3"]));
    const def = LoopDefSchema.parse(JSON.parse(readFileSync(join(repo, ".kunpeng", "loops", "plain.json"), "utf8")));
    expect(def.levers).toEqual([]);
    expect(def.goalId).toBeUndefined();
    expect(def.autonomous).toBeUndefined();
  });

  it("driver 接了配方注册与目标回填", () => {
    const driver = readFileSync(new URL("../../src/loop/driver.ts", import.meta.url), "utf8");
    expect(driver).toContain('import "./seo-internal-links.js"');
    expect(driver).toContain("goalMetricCurrent");
    expect(driver).toContain("setCurrent(");
  });
});