import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { runPlan } from "../../src/plan/orchestrator.js";
import type { PlanModel } from "../../src/plan/types.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { gateObservationsPath } from "../../src/runtime/gate-mode.js";
import { createLogger } from "../../src/runtime/logger.js";

// 本文件整体嵌在 spec 围栏里,正文不能出现三个反引号。
const FENCE = "`".repeat(3);
const PLAN_SPEC = ["# Plan", "", `${FENCE}scope`, "allow: src/in/**", FENCE, ""].join("\n");
const ENV_KEYS = ["KUNPENG_STATE", "KUNPENG_GATE_MODE_PLAN_SCOPE"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let repo: string;
let stateDir: string;

function ledger(root: string): Record<string, unknown>[] {
  if (!existsSync(gateObservationsPath(root))) return [];
  return readFileSync(gateObservationsPath(root), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

class InsideRunner implements AgentRunner {
  async run(req: AgentRequest): Promise<AgentResult> {
    if (req.stage === "implement" && req.cwd) {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(req.cwd, "src", "in"), { recursive: true });
      writeFileSync(join(req.cwd, "src", "in", "ok.ts"), "export const ok = 1;\n");
    }
    return { text: req.stage === "spec" ? "## acc\n- ok" : "code", meta: {} };
  }
}

const model: PlanModel = {
  phases: [{ title: "p0", flows: [{ id: "p0-0-0", title: "a", requirement: "do a", acceptanceCmd: 'node -e "process.exit(0)"' }] }],
};

beforeEach(async () => {
  for (const key of ENV_KEYS) { savedEnv[key] = process.env[key]; delete process.env[key]; }
  repo = mkdtempSync(join(tmpdir(), "kp-plan-scope-vis-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-plan-scope-vis-state-"));
  process.env.KUNPENG_STATE = stateDir;
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");
  writeFileSync(join(repo, "plan-spec.md"), PLAN_SPEC);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

function run(logs: string[], planRef: string) {
  return runPlan(model, {
    repoRoot: repo,
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner: new InsideRunner(),
    concurrency: 1,
    planRef,
    logger: createLogger({ minLevel: "info", sink: (line) => logs.push(line) }),
  });
}

describe("plan 终点范围门可观测 + 自身出错 fail-closed（作者锁定）", () => {
  test("范围内改动：verified，控制台与日志都写明比对了多少文件、越界 0；账本不记", async () => {
    const logs: string[] = [];
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await run(logs, join(repo, "plan-spec.md"));
    expect(result.status).toBe("verified");
    const line = out.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[plan-scope] 比对"));
    expect(line).toBeDefined();
    expect(line).toMatch(/比对 \d+ 个改动文件 · 越界 0/);
    expect(logs.some((l) => l.includes("plan-scope gate evaluated"))).toBe(true);
    expect(ledger(repo).filter((r) => r.gate === "plan-scope")).toEqual([]);
  }, 60_000);

  test("spec 不可读：照旧 verified，但 warn 一行 + 账本一行 wouldBlock=false/spec-unreadable", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await run(logs, join(repo, "nope-plan.md"));
    expect(result.status).toBe("verified");
    expect(logs.some((l) => l.includes("plan-scope gate skipped") && l.includes("spec unreadable"))).toBe(true);
    const rows = ledger(repo).filter((r) => r.gate === "plan-scope");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: "plan-scope", flowId: result.planId, wouldBlock: false });
    expect(String(rows[0]!.reason).startsWith("spec-unreadable:")).toBe(true);
  }, 60_000);

  test("源码：终点门没有静默 catch，评估异常走 fail-closed 分支", () => {
    const src = readFileSync(new URL("../../src/plan/orchestrator.ts", import.meta.url), "utf8");
    const at = src.indexOf("planScopeViolations(specText");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, at - 2500), at + 3000);
    expect(block).toContain("plan-scope gate error");
    expect(block).toContain("范围门执行失败");
    expect(block).toContain("gate-error:");
    expect(block).toContain("plan-scope gate skipped");
    expect(block).toContain("[plan-scope] 比对");
    expect(block).not.toMatch(/catch\s*\{\s*\n\s*\/\/[^\n]*non-fatal[^\n]*\n\s*\}/);
  });
});