import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FakeRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { gateObservationsPath } from "../../src/runtime/gate-mode.js";
import { createLogger } from "../../src/runtime/logger.js";

// 本文件整体嵌在 spec 的围栏里,正文不能出现三个反引号,scope 围栏用拼接生成。
const FENCE = "`".repeat(3);
const ENV_KEYS = ["KUNPENG_GATE_MODE_SCOPE", "KUNPENG_GATE_MODE_AUDIT", "KUNPENG_REQUIRE_SCOPE", "KUNPENG_KEEP_WORKTREE"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let repo: string;

const SCOPED_REQ = ["# 在 src/in 下加一个文件", "", `${FENCE}scope`, "allow: src/in/**", FENCE].join("\n");
const FORBID_ONLY_REQ = ["# 只写 forbid", "", `${FENCE}scope`, "forbid: src/zzz/**", FENCE].join("\n");
const NO_SCOPE_REQ = "# 没有范围声明的需求";
// 验收命令自己制造改动:越界的写 src/out,范围内的写 src/in;grep 是审计闸认可的内容级信号。
const ESCAPE_CMD = "mkdir -p src/out && echo x > src/out/x.ts && grep -q base README.md";
const INSIDE_CMD = "mkdir -p src/in && echo y > src/in/y.ts && grep -q base README.md";

function ledger(root: string): Record<string, unknown>[] {
  if (!existsSync(gateObservationsPath(root))) return [];
  return readFileSync(gateObservationsPath(root), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

function makeCycle(flowId: string, acceptanceCmd: string, logs: string[], opts: { requireScope?: boolean; planContext?: { planId: string; phase: number }; resolveBase?: (cwd: string) => Promise<string | undefined> } = {}): DevCycle {
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" },
    implement: { text: "done", meta: {}, backend: "claude" },
  });
  return new DevCycle({
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner,
    flowId,
    acceptanceCmd,
    logger: createLogger({ minLevel: "warn", sink: (line) => logs.push(line) }),
    ...(opts.requireScope === undefined ? {} : { requireScope: opts.requireScope }),
    ...(opts.planContext ? { planContext: opts.planContext } : {}),
    ...(opts.resolveBase ? { resolveBase: opts.resolveBase } : {}),
  });
}

beforeEach(async () => {
  for (const key of ENV_KEYS) { savedEnv[key] = process.env[key]; delete process.env[key]; }
  repo = mkdtempSync(join(tmpdir(), "kp-scope-main-"));
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(repo, { recursive: true, force: true });
});

describe("主路径范围门（verify 通过后、挂门前真比对改动文件）", () => {
  test("越界改动 → rolled-back，证据点名文件，rollback.kind=scope-gate，账本记 scope/wouldBlock/block", async () => {
    const logs: string[] = [];
    const result = await makeCycle("scope-drift", ESCAPE_CMD, logs).run(SCOPED_REQ);
    expect(result.status).toBe("rolled-back");
    expect(result.evidence ?? "").toContain("范围门未通过");
    expect(result.evidence ?? "").toContain("src/out/x.ts");
    const state = await new FlowTracker(join(repo, ".kunpeng", "state")).read("scope-drift");
    expect(state?.status).toBe("rolled-back");
    expect(state?.rollback?.kind).toBe("scope-gate");
    const rows = ledger(repo).filter((r) => r.gate === "scope");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: "scope", flowId: "scope-drift", wouldBlock: true, mode: "block" });
    expect(String(rows[0]!.reason)).toContain("src/out/x.ts");
  });

  test("范围内改动 → verified，不记账", async () => {
    const result = await makeCycle("scope-inside", INSIDE_CMD, []).run(SCOPED_REQ);
    expect(result.status).toBe("verified");
    expect(ledger(repo).filter((r) => r.gate === "scope")).toEqual([]);
  });

  test("KUNPENG_GATE_MODE_SCOPE=observe → 同一越界放行为 verified，warn 一行，账本 mode=observe", async () => {
    process.env.KUNPENG_GATE_MODE_SCOPE = "observe";
    const logs: string[] = [];
    const result = await makeCycle("scope-observe", ESCAPE_CMD, logs).run(SCOPED_REQ);
    expect(result.status).toBe("verified");
    expect(logs.some((l) => l.includes("observe 模式") && l.includes("src/out/x.ts"))).toBe(true);
    const rows = ledger(repo).filter((r) => r.gate === "scope");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mode: "observe", wouldBlock: true });
  });

  test("只写 forbid 的 scope → rolled-back（allow 缺失）", async () => {
    const result = await makeCycle("scope-forbid-only", INSIDE_CMD, []).run(FORBID_ONLY_REQ);
    expect(result.status).toBe("rolled-back");
    expect(result.evidence ?? "").toContain("没有 allow");
  });

  test("requireScope=true 且需求无 scope → 实现前就 rolled-back（scope 审计）", async () => {
    const result = await makeCycle("scope-required", INSIDE_CMD, [], { requireScope: true }).run(NO_SCOPE_REQ);
    expect(result.status).toBe("rolled-back");
    expect(result.evidence ?? "").toContain("scope 审计未通过");
  });

  test("requireScope 未传且 env 未设 → 无 scope 需求照旧 verified（DevCycle 缺省语义不变）", async () => {
    const result = await makeCycle("scope-legacy", INSIDE_CMD, []).run(NO_SCOPE_REQ);
    expect(result.status).toBe("verified");
  });

  test("plan 内的 flow 不走 per-flow 范围门（交给 plan 终点统一比对）→ 越界也 verified 且不记账", async () => {
    const result = await makeCycle("scope-in-plan", ESCAPE_CMD, [], { planContext: { planId: "plan-test-1", phase: 0 } }).run(SCOPED_REQ);
    expect(result.status).toBe("verified");
    expect(ledger(repo).filter((r) => r.gate === "scope")).toEqual([]);
  });

  test("resolveBase 注入假 sha 不影响范围门（基准由 DevCycle 自己 rev-parse）", async () => {
    const inside = await makeCycle("scope-bogus-base-in", INSIDE_CMD, [], { resolveBase: async () => "base-sha-123" }).run(SCOPED_REQ);
    expect(inside.status).toBe("verified");
    const outside = await makeCycle("scope-bogus-base-out", ESCAPE_CMD, [], { resolveBase: async () => "base-sha-123" }).run(SCOPED_REQ);
    expect(outside.status).toBe("rolled-back");
    expect(outside.evidence ?? "").toContain("src/out/x.ts");
  });
});