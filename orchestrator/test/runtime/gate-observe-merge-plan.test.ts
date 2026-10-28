import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { runPlan } from "../../src/plan/orchestrator.js";
import type { PlanModel } from "../../src/plan/types.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { gateModeFor, gateObservationsPath, gatesConfigPath, summarizeGateObservations } from "../../src/runtime/gate-mode.js";
import { createLogger } from "../../src/runtime/logger.js";
import { MERGE_REVIEW_GATE, defaultMergeReview, isObservableMergeFinding, reviewMerge, reviewMergeDiff } from "../../src/runtime/merge-review.js";

// 合并审查闸 + 方案级范围门两处接缝:判定"应拦"→ 先记账;observe 放行(warn 一行),block 与现状完全一致。
// 硬底线:密钥/冲突标记/空 diff/解析失败/上下文缺失在 observe 下仍拦。
const ENV_KEYS = ["KUNPENG_STATE", "KUNPENG_GATE_MODE_MERGE_REVIEW", "KUNPENG_GATE_MODE_PLAN_SCOPE"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let repo: string;
let stateDir: string;

function ledger(root: string): Record<string, unknown>[] {
  if (!existsSync(gateObservationsPath(root))) return [];
  return readFileSync(gateObservationsPath(root), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeEach(() => {
  for (const key of ENV_KEYS) { savedEnv[key] = process.env[key]; delete process.env[key]; }
  repo = mkdtempSync(join(tmpdir(), "kp-gate-observe2-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-gate-observe2-state-"));
  process.env.KUNPENG_STATE = stateDir;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

describe("合并审查闸 reviewMerge 的 observe 接缝(作者锁定)", () => {
  const PROTECTED_ISSUE = "改动触及宪法/角色卡/AGENTS/技能规则，属于人工门 #2 范围";
  // 冲突标记动态拼接:源码里不出现字面 7 连标记,否则合并门会拦本测试自身。
  const CONFLICT = `${"<".repeat(7)} HEAD`;
  const SECRET_LINE = 'OPENAI_API_KEY="sk-added-secret-that-must-block-0001"';

  function diffFor(path: string, added: string): string {
    return [
      `diff --git a/${path} b/${path}`,
      "index 1111111..2222222 100644",
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1 +1 @@",
      "-old",
      `+${added}`,
    ].join("\n");
  }
  const BINARY_DIFF = [
    "diff --git a/assets/logo.png b/assets/logo.png",
    "new file mode 100644",
    "index 0000000..2222222",
    "GIT binary patch",
  ].join("\n");
  const ctx = (diff: string, flowId = "f1") => ({ repoRoot: repo, flowId, base: "main", diff });
  const OBSERVE_ENV = { KUNPENG_GATE_MODE_MERGE_REVIEW: "observe" };

  beforeEach(() => {
    // 账本只落真实仓库根(含 .git);这里不需要真 git,占个 .git 目录即可。
    mkdirSync(join(repo, ".git"), { recursive: true });
  });

  test("gate 名固定为 merge-review;gateModeFor 读 env 与 .kunpeng/gates.json", () => {
    expect(MERGE_REVIEW_GATE).toBe("merge-review");
    expect(gateModeFor("merge-review", repo, { KUNPENG_STATE: stateDir })).toBe("block");
    expect(gateModeFor("merge-review", repo, OBSERVE_ENV)).toBe("observe");
    mkdirSync(join(repo, ".kunpeng"), { recursive: true });
    writeFileSync(gatesConfigPath(stateDir), JSON.stringify({ "merge-review": "observe" }));
    expect(gateModeFor("merge-review", repo, { KUNPENG_STATE: stateDir })).toBe("observe");
    expect(gateModeFor("plan-scope", repo, { KUNPENG_STATE: stateDir })).toBe("block");
  });

  test("可观察类判定 = 保护文件 + 二进制;密钥/冲突标记/空 diff 不在其列", () => {
    const pick = (diff: string) => reviewMergeDiff(ctx(diff)).details.map(isObservableMergeFinding);
    expect(pick(diffFor("constitution/core.md", "改写"))).toEqual([true]);
    expect(pick(BINARY_DIFF)).toEqual([true]);
    expect(pick(diffFor(".env.example", SECRET_LINE))).toEqual([false]);
    expect(pick(diffFor("src/a.ts", CONFLICT))).toEqual([false]);
    expect(pick(" ")).toEqual([false]);
  });

  test("block(默认):保护文件照旧拦,返回值与 reviewMergeDiff 完全一致;账本记 wouldBlock/mode=block;不打 observe 文案", async () => {
    const warns: string[] = [];
    const c = ctx(diffFor("constitution/core.md", "C10 forbidden"), "mr-block");
    const result = await reviewMerge(c, { env: { KUNPENG_STATE: stateDir }, warn: (m) => warns.push(m) });
    expect(result).toEqual(reviewMergeDiff(c));
    expect(result.block).toBe(true);
    expect(result.observed).toBeUndefined();
    const rows = ledger(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: "merge-review", flowId: "mr-block", wouldBlock: true, mode: "block" });
    expect(String(rows[0]!.reason)).toBe(`constitution/core.md: ${PROTECTED_ISSUE}`);
    expect(warns).toEqual([]);
  });

  test("observe(注入 env):保护文件放行 block=false/observed=true,findings 原样保留;warn 一行固定文案;账本落 mode=observe", async () => {
    const warns: string[] = [];
    const c = ctx(diffFor("constitution/core.md", "C10 forbidden"), "mr-observe");
    const pure = reviewMergeDiff(c);
    const result = await reviewMerge(c, { env: OBSERVE_ENV, warn: (m) => warns.push(m) });
    expect(result.block).toBe(false);
    expect(result.observed).toBe(true);
    expect(result.findings).toEqual(pure.findings);
    expect(result.details).toEqual(pure.details);
    expect(warns).toEqual([`[gate:merge-review] observe 模式：本会拦下 → constitution/core.md: ${PROTECTED_ISSUE}`]);
    const rows = ledger(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: "merge-review", flowId: "mr-observe", wouldBlock: true, mode: "observe" });
    expect(summarizeGateObservations(readFileSync(gateObservationsPath(repo), "utf8").split("\n"))).toEqual({ "merge-review": { total: 1, wouldBlock: 1 } });
  });

  test("observe:二进制补丁(形态类)亦放行", async () => {
    const result = await reviewMerge(ctx(BINARY_DIFF), { env: OBSERVE_ENV, warn: () => {} });
    expect(result.block).toBe(false);
    expect(result.observed).toBe(true);
    expect(ledger(repo)).toHaveLength(1);
  });

  test("硬底线:observe 下密钥命中仍拦,返回值与 block 完全一致;账本仍记一行且不落密钥片段;warn 说明硬底线", async () => {
    const warns: string[] = [];
    const c = ctx(diffFor(".env.example", SECRET_LINE), "mr-secret");
    const result = await reviewMerge(c, { env: OBSERVE_ENV, warn: (m) => warns.push(m) });
    expect(result).toEqual(reviewMergeDiff(c));
    expect(result.block).toBe(true);
    expect(result.observed).toBeUndefined();
    const rows = ledger(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: "merge-review", flowId: "mr-secret", wouldBlock: true, mode: "observe" });
    expect(String(rows[0]!.reason)).toBe(".env.example: 新增内容疑似包含 OpenAI API key");
    expect(readFileSync(gateObservationsPath(repo), "utf8")).not.toContain("sk-added");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("硬底线");
    expect(warns[0]).not.toContain("本会拦下");
  });

  test("硬底线:observe 下冲突标记仍拦", async () => {
    const c = ctx(diffFor("src/a.ts", CONFLICT));
    const result = await reviewMerge(c, { env: OBSERVE_ENV, warn: () => {} });
    expect(result).toEqual(reviewMergeDiff(c));
    expect(result.block).toBe(true);
  });

  test("硬底线:observe 下保护文件 + 密钥混合 → 整体仍拦(不能因为有可观察项就放行)", async () => {
    const c = ctx(`${diffFor("constitution/core.md", "改写")}\n${diffFor("src/cfg.ts", SECRET_LINE)}`);
    const result = await reviewMerge(c, { env: OBSERVE_ENV, warn: () => {} });
    expect(result.block).toBe(true);
    expect(result.observed).toBeUndefined();
  });

  test("硬底线:observe 下空 diff / 上下文缺失仍拦", async () => {
    const empty = await reviewMerge(ctx(" "), { env: OBSERVE_ENV, warn: () => {} });
    expect(empty.block).toBe(true);
    const blank = await reviewMerge({ repoRoot: repo, flowId: " ", base: " ", diff: diffFor("src/ok.ts", "fine") }, { env: OBSERVE_ENV, warn: () => {} });
    expect(blank.block).toBe(true);
    expect(ledger(repo)).toHaveLength(2);
  });

  test("不传 opts 时读 process.env:KUNPENG_GATE_MODE_MERGE_REVIEW=observe 经 defaultMergeReview 放行", async () => {
    process.env.KUNPENG_GATE_MODE_MERGE_REVIEW = "observe";
    const result = await defaultMergeReview(ctx(diffFor("AGENTS.md", "+新增规则")));
    expect(result.block).toBe(false);
    expect(result.observed).toBe(true);
    expect(ledger(repo)).toHaveLength(1);
  });

  test(".kunpeng/gates.json {merge-review: observe} 亦放行", async () => {
    mkdirSync(join(repo, ".kunpeng"), { recursive: true });
    writeFileSync(gatesConfigPath(stateDir), JSON.stringify({ "merge-review": "observe" }));
    const result = await reviewMerge(ctx(diffFor("roster/dev.role.md", "改角色卡")), { env: { KUNPENG_STATE: stateDir }, warn: () => {} });
    expect(result.block).toBe(false);
    expect(ledger(repo)[0]).toMatchObject({ mode: "observe" });
  });

  test("通过的 diff 两种模式都不记账、不 warn", async () => {
    const warns: string[] = [];
    const c = ctx(diffFor("src/runtime/example.ts", "export const value = 1;"));
    expect(await reviewMerge(c, { env: { KUNPENG_STATE: stateDir }, warn: (m) => warns.push(m) })).toEqual(reviewMergeDiff(c));
    expect(await reviewMerge(c, { env: OBSERVE_ENV, warn: (m) => warns.push(m) })).toEqual(reviewMergeDiff(c));
    expect(ledger(repo)).toEqual([]);
    expect(warns).toEqual([]);
  });

  test("占位 repoRoot(无 .git):模式照常生效,但账本不落盘、只 warn 一句", async () => {
    const fake = mkdtempSync(join(tmpdir(), "kp-gate-observe2-fake-"));
    try {
      const warns: string[] = [];
      const result = await reviewMerge({ repoRoot: fake, flowId: "f1", base: "main", diff: diffFor("AGENTS.md", "x") }, { env: OBSERVE_ENV, warn: (m) => warns.push(m) });
      expect(result.block).toBe(false);
      expect(existsSync(gateObservationsPath(fake))).toBe(false);
      expect(warns.some((w) => w.includes("未知 repoRoot"))).toBe(true);
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });
});

describe("方案级范围门(runPlan planRef scope)的 observe 接缝(作者锁定)", () => {
  // 围栏用拼接生成:本文件整体要作为作者锁定块嵌进 spec 的 markdown 围栏里,正文不能出现三个反引号。
  const FENCE = "`".repeat(3);
  const PLAN_SPEC = ["# Plan", "", `${FENCE}scope`, "allow: src/in/**", FENCE, ""].join("\n");

  /** implement 阶段真往 worktree 写一个越界文件(src/out/x.ts),让集成分支相对 main 出现范围外改动。 */
  class WritingRunner implements AgentRunner {
    async run(req: AgentRequest): Promise<AgentResult> {
      if (req.stage === "implement" && req.cwd) {
        mkdirSync(join(req.cwd, "src", "out"), { recursive: true });
        writeFileSync(join(req.cwd, "src", "out", "x.ts"), "export const x = 1;\n");
      }
      return { text: req.stage === "spec" ? "## acc\n- ok" : "code", meta: {} };
    }
  }

  const model: PlanModel = {
    phases: [{ title: "p0", flows: [{ id: "p0-0-0", title: "a", requirement: "do a", acceptanceCmd: 'node -e "process.exit(0)"' }] }],
  };

  beforeEach(async () => {
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

  function run(logs: string[]) {
    return runPlan(model, {
      repoRoot: repo,
      store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
      ws: new Workspace(repo),
      tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
      runner: new WritingRunner(),
      concurrency: 1,
      planRef: join(repo, "plan-spec.md"),
      logger: createLogger({ minLevel: "warn", sink: (line) => logs.push(line) }),
    });
  }

  test("block(默认):越界照旧 stopped + integrationErrors;账本记 gate=plan-scope/flowId=planId/mode=block", async () => {
    const logs: string[] = [];
    const result = await run(logs);
    expect(result.status).toBe("stopped");
    expect(result.integrationErrors).toEqual(["范围越界: src/out/x.ts (outside-allow)"]);
    const rows = ledger(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: "plan-scope", flowId: result.planId, wouldBlock: true, mode: "block", reason: "src/out/x.ts（outside-allow）" });
    expect(logs.some((l) => l.includes("observe 模式"))).toBe(false);
  }, 60_000);

  test("env KUNPENG_GATE_MODE_PLAN_SCOPE=observe:同一越界放行 → verified;warn 一行;账本落 mode=observe", async () => {
    process.env.KUNPENG_GATE_MODE_PLAN_SCOPE = "observe";
    const logs: string[] = [];
    const result = await run(logs);
    expect(result.status).toBe("verified");
    expect(result.integrationErrors).toBeUndefined();
    expect(logs.filter((l) => l.includes("[gate:plan-scope] observe 模式：本会拦下 → src/out/x.ts（outside-allow）"))).toHaveLength(1);
    const rows = ledger(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: "plan-scope", flowId: result.planId, wouldBlock: true, mode: "observe" });
  }, 60_000);

  test(".kunpeng/gates.json {plan-scope: observe} 亦放行", async () => {
    mkdirSync(join(repo, ".kunpeng"), { recursive: true });
    writeFileSync(gatesConfigPath(stateDir), JSON.stringify({ "plan-scope": "observe" }));
    const result = await run([]);
    expect(result.status).toBe("verified");
    expect(ledger(repo)).toHaveLength(1);
  }, 60_000);
});