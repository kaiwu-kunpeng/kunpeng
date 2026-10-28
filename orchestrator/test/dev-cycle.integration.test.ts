import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../src/artifacts/store.js";
import { Workspace } from "../src/git/workspace.js";
import { FakeRunner } from "../src/agent/runner.js";
import type { AgentRunner, AgentRequest } from "../src/agent/runner.js";
import { DevCycle } from "../src/loop/dev-cycle.js";
import { FlowTracker } from "../src/runtime/flowstate.js";

let repo: string, store: ArtifactStore, ws: Workspace;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-dc-"));
  const g = simpleGit(repo);
  await g.init(); await g.addConfig("user.email", "t@t.t"); await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n"); await g.add("."); await g.commit("init");
  store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  ws = new Workspace(repo);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("happy path: spec-defined test passes -> verified spec", async () => {
  const runner = new FakeRunner({
    // 验证命令来自 spec 阶段（验收标准），不来自实现者（C3）
    spec: { text: "## acceptance\n- prints ok", meta: { testCmd: "node -e \"process.exit(0)\"" } },
    implement: { text: "wrote code", meta: {} },
  });
  const dc = new DevCycle({ store, ws, runner, flowId: "s1" });
  const result = await dc.run("build a thing that prints ok");
  expect(result.status).toBe("verified");
  const spec = await store.read("s1");
  expect(spec.status).toBe("verified");
  expect(spec.meta.commit).toBeTruthy();
  const branches = await simpleGit(repo).branchLocal();
  expect(branches.all).toContain("kp/s1");
});

test("spec-defined test fails -> rolls back", async () => {
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- x", meta: { testCmd: "node -e \"process.exit(1)\"" } },
    implement: { text: "wrote buggy code", meta: {} },
  });
  const dc = new DevCycle({ store, ws, runner, flowId: "s2" });
  const result = await dc.run("build broken thing");
  expect(result.status).toBe("rolled-back");
  const spec = await store.read("s2");
  expect(spec.status).toBe("rolled-back");
  const branches = await simpleGit(repo).branchLocal();
  expect(branches.all).not.toContain("kp/s2");
});

test("implementer cannot weaken verification — spec's test governs (C3)", async () => {
  const runner = new FakeRunner({
    // spec 的验收命令会失败；实现者却给了个会通过的弱命令——必须以 spec 为准 → 回滚
    spec: { text: "## acceptance\n- must be ok", meta: { testCmd: "node -e \"process.exit(1)\"" } },
    implement: { text: "wrote code + a passing weak test", meta: { testCmd: "node -e \"process.exit(0)\"" } },
  });
  const dc = new DevCycle({ store, ws, runner, flowId: "s3" });
  const result = await dc.run("must produce ok");
  expect(result.status).toBe("rolled-back");
});

test("explicit acceptanceCmd from the plan overrides the spec agent's fragile one (P1)", async () => {
  const runner = new FakeRunner({
    spec: { text: "x", meta: { testCmd: "node -e \"process.exit(1)\"" } }, // spec 自拟的会失败
    implement: { text: "done", meta: {} },
  });
  const dc = new DevCycle({ store, ws, runner, flowId: "s8", acceptanceCmd: "node -e \"process.exit(0)\"" });
  const result = await dc.run("req");
  expect(result.status).toBe("verified");  // 用方案带来的验收命令（通过），而非 spec 的（失败）
});

test("precomputedSpec 跳过 spec 阶段、直接喂 implement（省 token）", async () => {
  const seen: Array<{ stage: string; input: string }> = [];
  const recording: AgentRunner = {
    async run(req: AgentRequest) {
      seen.push({ stage: req.stage, input: req.input });
      return { text: "done", meta: {} };
    },
  };
  const dc = new DevCycle({
    store,
    ws,
    runner: recording,
    flowId: "pc1",
    precomputedSpec: { text: "共享SPEC文本", meta: {} },
    acceptanceCmd: "node -e \"process.exit(0)\"",
  });

  const result = await dc.run("原始需求");

  expect(seen.map((s) => s.stage)).not.toContain("spec");
  expect(seen.find((s) => s.stage === "implement")?.input).toBe("共享SPEC文本");
  expect(result.status).toBe("verified");
  expect((await store.read("pc1")).body.trimEnd()).toBe("共享SPEC文本");
});

test("adaptiveTopology + simple 需求 + acceptanceCmd → 走 lite,跳过 spec 阶段", async () => {
  const seen: Array<{ stage: string; input: string }> = [];
  const recording: AgentRunner = {
    async run(req: AgentRequest) {
      seen.push({ stage: req.stage, input: req.input });
      return { text: "done", meta: {} };
    },
  };
  const dc = new DevCycle({
    store,
    ws,
    runner: recording,
    flowId: "lite1",
    adaptiveTopology: true,
    acceptanceCmd: "node -e \"process.exit(0)\"",
  });
  const requirement = "加个小函数 isEven 返回偶数判断";

  const result = await dc.run(requirement);

  expect(seen.map((s) => s.stage)).not.toContain("spec");
  expect(seen.find((s) => s.stage === "implement")?.input).toBe(requirement);
  expect(result.status).toBe("verified");
});

test("adaptiveTopology + complex 需求 → 仍跑 spec(全路径)", async () => {
  const seen: Array<{ stage: string; input: string }> = [];
  const recording: AgentRunner = {
    async run(req: AgentRequest) {
      seen.push({ stage: req.stage, input: req.input });
      return req.stage === "spec"
        ? { text: "复杂需求 SPEC", meta: { testCmd: "node -e \"process.exit(0)\"" } }
        : { text: "done", meta: {} };
    },
  };
  const dc = new DevCycle({
    store,
    ws,
    runner: recording,
    flowId: "lite2",
    adaptiveTopology: true,
    acceptanceCmd: "node -e \"process.exit(0)\"",
  });

  const result = await dc.run("重构整体架构迁移多个模块");

  expect(seen.map((s) => s.stage)).toContain("spec");
  expect(result.status).toBe("verified");
});

test("不开 adaptiveTopology → 永远跑 spec(向后兼容)", async () => {
  const seen: Array<{ stage: string; input: string }> = [];
  const recording: AgentRunner = {
    async run(req: AgentRequest) {
      seen.push({ stage: req.stage, input: req.input });
      return req.stage === "spec"
        ? { text: "简单需求 SPEC", meta: { testCmd: "node -e \"process.exit(0)\"" } }
        : { text: "done", meta: {} };
    },
  };
  const dc = new DevCycle({ store, ws, runner: recording, flowId: "lite3" });

  const result = await dc.run("加个小函数 isEven 返回偶数判断");

  expect(seen.map((s) => s.stage)).toContain("spec");
  expect(result.status).toBe("verified");
});

test("adaptiveTopology 但无 acceptanceCmd → 不能 lite,仍跑 spec", async () => {
  const seen: Array<{ stage: string; input: string }> = [];
  const recording: AgentRunner = {
    async run(req: AgentRequest) {
      seen.push({ stage: req.stage, input: req.input });
      return req.stage === "spec"
        ? { text: "简单需求 SPEC", meta: { testCmd: "node -e \"process.exit(0)\"" } }
        : { text: "done", meta: {} };
    },
  };
  const dc = new DevCycle({
    store,
    ws,
    runner: recording,
    flowId: "lite4",
    adaptiveTopology: true,
  });

  const result = await dc.run("加个小函数 isEven 返回偶数判断");

  expect(seen.map((s) => s.stage)).toContain("spec");
  expect(result.status).toBe("verified");
});

test("不传 precomputedSpec 时仍照常跑 spec 阶段（向后兼容）", async () => {
  const seen: Array<{ stage: string; input: string }> = [];
  const recording: AgentRunner = {
    async run(req: AgentRequest) {
      seen.push({ stage: req.stage, input: req.input });
      return req.stage === "spec"
        ? { text: "x", meta: { testCmd: "node -e \"process.exit(0)\"" } }
        : { text: "done", meta: {} };
    },
  };
  const dc = new DevCycle({ store, ws, runner: recording, flowId: "pc2" });

  const result = await dc.run("原始需求");

  expect(seen.map((s) => s.stage)).toContain("spec");
  expect(result.status).toBe("verified");
});

test("sub-agents receive the project's rules as system prompt (multi-agent coordination)", async () => {
  const seen: string[] = [];
  const recording: AgentRunner = {
    async run(req: AgentRequest) {
      seen.push(req.system);
      return req.stage === "spec"
        ? { text: "x", meta: { testCmd: "node -e \"process.exit(0)\"" } }
        : { text: "done", meta: {} };
    },
  };
  const dc = new DevCycle({ store, ws, runner: recording, flowId: "s7", projectRules: "项目自己的 AGENTS.md 规则" });
  await dc.run("req");
  // spec + implement 都带项目规则，且压轴追加递归守卫覆盖段（防「改动必须走 loop」被 loop 内 agent 照章递归派发）
  expect(seen.every((s) => s.startsWith("项目自己的 AGENTS.md 规则"))).toBe(true);
  expect(seen.every((s) => s.includes("你已在鲲鹏 loop 内部"))).toBe(true);
});

test("baseline-red project check that's UNCHANGED does NOT block (differential verification)", async () => {
  const runner = new FakeRunner({
    spec: { text: "## acceptance", meta: { testCmd: "node -e \"process.exit(0)\"" } }, // 验收通过
    implement: { text: "wrote code", meta: {} },                                        // FakeRunner 不改文件
  });
  // 项目检查本来就红（稳定输出）：实现前后输出一致 → 无基线之外的新错 → 不应回滚（真项目基线红是常态）。
  const redButStable = "node -e \"console.error('preexisting error TS1'); process.exit(1)\"";
  const dc = new DevCycle({ store, ws, runner, flowId: "s6", checks: [redButStable] });
  const result = await dc.run("req on a project with a red baseline");
  expect(result.status).toBe("verified");  // 差分：基线红但未恶化 → 放行
});

test("weak acceptance test (test -f) is rejected by the audit role BEFORE implement", async () => {
  // 没有 implement 脚本：若审计没拦住、跑到实现阶段，FakeRunner 会抛 "no scripted result"。
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- file exists", meta: { testCmd: "test -f hello.txt" } },
  });
  const dc = new DevCycle({ store, ws, runner, flowId: "s5" });
  const result = await dc.run("weak test requirement");
  expect(result.status).toBe("rolled-back");
  expect(result.evidence).toMatch(/审计/);
  const spec = await store.read("s5");
  expect(spec.status).toBe("rolled-back");
});

test("vitest acceptance naming a missing test file is rejected BEFORE implement", async () => {
  // 没有 implement 脚本：若审计没拦住、跑到实现阶段，FakeRunner 会抛 "no scripted result"。
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- run the locked test", meta: { testCmd: "npx vitest run test/missing.test.ts" } },
  });
  const dc = new DevCycle({ store, ws, runner, flowId: "s5b" });
  const result = await dc.run("missing vitest test should fail audit");
  expect(result.status).toBe("rolled-back");
  expect(result.evidence).toContain("vitest 命令点名的测试文件不存在: test/missing.test.ts");
  const spec = await store.read("s5b");
  expect(spec.status).toBe("rolled-back");
});

test("spec gave no verification command -> fails closed (cannot verify)", async () => {
  const runner = new FakeRunner({
    spec: { text: "## acceptance\n- x", meta: {} },        // 无 testCmd
    implement: { text: "wrote code", meta: { testCmd: "node -e \"process.exit(0)\"" } },
  });
  const dc = new DevCycle({ store, ws, runner, flowId: "s4" });
  const result = await dc.run("no spec test");
  expect(result.status).toBe("rolled-back");
});

test("plan context: flow records planId/phase and sets NO per-flow merge gate", async () => {
  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
  const runner = new FakeRunner({
    spec: { text: "## acc\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"" } },
    implement: { text: "code", meta: {} },
  });
  const dc = new DevCycle({ store, ws, runner, flowId: "p1f0", tracker, planContext: { planId: "plan-x", phase: 0 } });
  const r = await dc.run("do a thing");
  expect(r.status).toBe("verified");
  const fs = await tracker.read("p1f0");
  expect(fs?.planId).toBe("plan-x");
  expect(fs?.phase).toBe(0);
  expect(fs?.humanGate).toBeUndefined();   // plan 内不挂 per-flow 合并门
});

test("records positive agent result tokens into the flow tracker", async () => {
  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
  const addTokens = vi.spyOn(tracker, "addTokens");
  const addStageTokens = vi.spyOn(tracker, "addStageTokens");
  const runner = new FakeRunner({
    spec: { text: "## acc\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"", tokens: 200 } },
    implement: { text: "code", meta: { tokens: 1000 } },
  });
  const dc = new DevCycle({ store, ws, runner, flowId: "tok1", tracker });

  const result = await dc.run("count tokens");

  expect(result.status).toBe("verified");
  expect(addTokens).toHaveBeenCalledWith("tok1", 200);
  expect(addTokens).toHaveBeenCalledWith("tok1", 1000);
  expect(addStageTokens).toHaveBeenCalledWith("tok1", "spec", 200);
  expect(addStageTokens).toHaveBeenCalledWith("tok1", "implement", 1000);
  const state = await tracker.read("tok1");
  expect(state?.tokensUsed).toBe(1200);
  expect(state?.stageTokens).toEqual({ spec: 200, implement: 1000 });
});

test("does not record missing or invalid agent result tokens", async () => {
  const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
  const addTokens = vi.spyOn(tracker, "addTokens");
  const addStageTokens = vi.spyOn(tracker, "addStageTokens");
  const runner = new FakeRunner({
    spec: { text: "## acc\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"", tokens: 0 } },
    implement: { text: "code", meta: { tokens: "1000" } },
  });
  const dc = new DevCycle({ store, ws, runner, flowId: "tok2", tracker, acceptanceCmd: "node -e \"process.exit(0)\"" });

  const result = await dc.run("ignore invalid tokens");

  expect(result.status).toBe("verified");
  expect(addTokens).not.toHaveBeenCalled();
  expect(addStageTokens).not.toHaveBeenCalled();
  expect((await tracker.read("tok2"))?.tokensUsed).toBeUndefined();
});
