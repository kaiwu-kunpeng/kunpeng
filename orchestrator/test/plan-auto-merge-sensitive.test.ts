import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../src/agent/runner.js";
import { Workspace } from "../src/git/workspace.js";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { createLogger } from "../src/runtime/logger.js";
import { SENSITIVE_GATE_NOTE } from "../src/runtime/sensitive-paths.js";
import { runPlan, type RunPlanDeps } from "../src/plan/orchestrator.js";
import type { PlanModel } from "../src/plan/types.js";

/** 段内唯一一条流,验收恒绿;实现阶段由 WritingRunner 往流 worktree 落文件,让集成分支真的带上该改动。 */
const model: PlanModel = {
  phases: [{ title: "p0", flows: [{ id: "p0-0-0", title: "a", requirement: "do a", acceptanceCmd: "node -e \"process.exit(0)\"" }] }],
};

/** 像 FakeRunner 一样按 stage 返回预设结果,但 implement 阶段会在 req.cwd(流 worktree)里写入指定文件。 */
class WritingRunner implements AgentRunner {
  constructor(private files: string[]) {}
  async run(req: AgentRequest): Promise<AgentResult> {
    if (req.stage === "spec") return { text: "## acc\n- ok", meta: {} };
    if (req.stage === "implement") {
      for (const file of this.files) {
        mkdirSync(dirname(join(req.cwd!, file)), { recursive: true });
        writeFileSync(join(req.cwd!, file), `// ${file}\n`);
      }
      return { text: "code", meta: {} };
    }
    throw new Error(`no scripted result for stage: ${req.stage}`);
  }
}

let repo: string;
let main: string;
const savedEnv = process.env.KUNPENG_AUTO_MERGE;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-plan-automerge-sens-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  main = (await g.branchLocal()).current;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.KUNPENG_AUTO_MERGE;
  else process.env.KUNPENG_AUTO_MERGE = savedEnv;
  rmSync(repo, { recursive: true, force: true });
});

function harness(files: string[], extra: Partial<RunPlanDeps> = {}) {
  const mergeCalls: Array<[string, string, string | undefined]> = [];
  const logs: string[] = [];
  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"), () => 42);
  const deps: RunPlanDeps = {
    repoRoot: repo,
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker,
    runner: new WritingRunner(files),
    concurrency: 1,
    logger: createLogger({ minLevel: "debug", sink: (line) => { logs.push(line); } }),
    mergeAndClearGate: async (repoRoot, flowId, base) => { mergeCalls.push([repoRoot, flowId, base]); return { ok: true }; },
    ...extra,
  };
  return { deps, tracker, mergeCalls, logs };
}

describe("plan 自动门(KUNPENG_AUTO_MERGE=1)前的敏感路径闸(作者锁定)", () => {
  test("集成分支改了 src/server/auth.ts → 不调 mergeAndClearGate,打标 sensitive,门文案缀敏感说明,主干未动", async () => {
    process.env.KUNPENG_AUTO_MERGE = "1";
    const g = simpleGit(repo);
    const mainBefore = await g.revparse(["HEAD"]);
    const h = harness(["src/server/auth.ts", "lib/plain.ts"]);

    const r = await runPlan(model, h.deps);

    expect(r.status).toBe("verified");
    expect(h.mergeCalls).toEqual([]);
    expect(await g.revparse(["HEAD"])).toBe(mainBefore);
    // 真 git diff 接线:命中来自集成分支 kp/<planId> 对 base 的差集
    const s = await h.tracker.read(r.planId);
    expect(s?.status).toBe("verified");
    expect(s?.sensitive).toEqual({ hits: [{ file: "src/server/auth.ts", label: "鉴权/授权" }], at: 42 });
    expect(s?.humanGate?.gate).toBe(`合并主干 (人工门#1) · ${SENSITIVE_GATE_NOTE}：鉴权/授权`);
    expect(s?.humanGate?.what).toBe(`${r.integrationBranch} → ${main}`);
    expect(s?.history.at(-1)).toEqual({ stage: "sensitive-marked", at: 42 });
    expect(h.logs.some((line) => line.includes("[plan] 敏感路径改动，自动合并改为人工门：鉴权/授权"))).toBe(true);
    expect(h.logs.some((line) => line.includes("自动门：未自动合，保留人工门") && line.includes(`${SENSITIVE_GATE_NOTE}：鉴权/授权`))).toBe(true);
    expect(h.logs.some((line) => line.includes("自动门：已自动合并主干"))).toBe(false);
  });

  test("未命中敏感路径 → 行为不变:mergeAndClearGate(repoRoot, planId, base) 照调一次,不打标,门文案原样", async () => {
    process.env.KUNPENG_AUTO_MERGE = "1";
    const h = harness(["lib/plain.ts"]);

    const r = await runPlan(model, h.deps);

    expect(r.status).toBe("verified");
    expect(h.mergeCalls).toEqual([[repo, r.planId, main]]);
    const s = await h.tracker.read(r.planId);
    expect(s?.sensitive).toBeUndefined();
    expect(s?.humanGate).toEqual({ gate: "合并主干 (人工门#1)", what: `${r.integrationBranch} → ${main}` });
    expect(h.logs.some((line) => line.includes("自动门：已自动合并主干"))).toBe(true);
    expect(h.logs.some((line) => line.includes("[plan] 敏感路径改动"))).toBe(false);
  });

  test("敏感检测本身抛错 → 保守留门:不合并、不打标、日志带原因", async () => {
    process.env.KUNPENG_AUTO_MERGE = "1";
    const h = harness(["lib/plain.ts"], { sensitiveHits: async () => { throw new Error("git diff 炸了"); } });

    const r = await runPlan(model, h.deps);

    expect(r.status).toBe("verified");
    expect(h.mergeCalls).toEqual([]);
    const s = await h.tracker.read(r.planId);
    expect(s?.sensitive).toBeUndefined();
    expect(s?.humanGate?.gate).toBe("合并主干 (人工门#1)");
    expect(h.logs.some((line) => line.includes("自动门：未自动合，保留人工门") && line.includes("git diff 炸了"))).toBe(true);
  });

  test("env 未设时完全照旧:即使改了敏感文件也不检测、不打标、不合并(交 autopilot / 人工门)", async () => {
    delete process.env.KUNPENG_AUTO_MERGE;
    const h = harness(["src/server/auth.ts"], { sensitiveHits: async () => { throw new Error("不该检测"); } });

    const r = await runPlan(model, h.deps);

    expect(r.status).toBe("verified");
    expect(h.mergeCalls).toEqual([]);
    const s = await h.tracker.read(r.planId);
    expect(s?.sensitive).toBeUndefined();
    expect(s?.humanGate).toEqual({ gate: "合并主干 (人工门#1)", what: `${r.integrationBranch} → ${main}` });
    expect(h.logs.some((line) => line.includes("自动门"))).toBe(false);
  });
});