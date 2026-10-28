import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FakeRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { computeHarnessStamp, HARNESS_GATE_FILES, type HarnessStamp } from "../../src/runtime/harness-stamp.js";

const SRC = new URL("../../src/", import.meta.url).pathname;

describe("computeHarnessStamp", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kp-harness-"));
    mkdirSync(join(root, "src", "verify"), { recursive: true });
    mkdirSync(join(root, "src", "util"), { recursive: true });
    writeFileSync(join(root, "src", "verify", "gate.ts"), "export const g = 1;\n");
    writeFileSync(join(root, "src", "util", "other.ts"), "export const o = 1;\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const git = async (args: string[]): Promise<string> => (args[0] === "rev-parse" ? "abc123\n" : "");

  it("门源码变 → gateHash 变；非门文件变 → 不变；结果确定", async () => {
    const a = await computeHarnessStamp(root, { git, now: () => 1 });
    const again = await computeHarnessStamp(root, { git, now: () => 1 });
    expect(again.gateHash).toBe(a.gateHash);
    expect(a.gateHash).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(join(root, "src", "util", "other.ts"), "export const o = 2;\n");
    expect((await computeHarnessStamp(root, { git })).gateHash).toBe(a.gateHash);
    writeFileSync(join(root, "src", "verify", "gate.ts"), "export const g = 2;\n");
    expect((await computeHarnessStamp(root, { git })).gateHash).not.toBe(a.gateHash);
  });

  it("gitSha 取 rev-parse；status 有输出 → dirty", async () => {
    const s = await computeHarnessStamp(root, { git: async (args) => (args[0] === "rev-parse" ? "deadbeef\n" : " M src/x.ts\n"), now: () => 7 });
    expect(s).toMatchObject({ gitSha: "deadbeef", dirty: true, at: 7 });
  });

  it("git 失败 → gitSha/dirty 为 null，不抛", async () => {
    const s = await computeHarnessStamp(root, { git: async () => { throw new Error("no git"); } });
    expect(s.gitSha).toBeNull();
    expect(s.dirty).toBeNull();
    expect(s.gateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("门文件清单覆盖裁判核心", () => {
    for (const f of ["src/verify/gate.ts", "src/runtime/merge-gate.ts", "src/runtime/sensitive-paths.ts", "src/loop/dev-cycle.ts", "src/plan/spec-lint.ts"]) {
      expect(HARNESS_GATE_FILES).toContain(f);
    }
  });
});

describe("DevCycle 记录 harness", () => {
  let repo: string;
  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), "kp-harness-dc-"));
    const g = simpleGit(repo);
    await g.init();
    await g.addConfig("user.email", "t@t.t");
    await g.addConfig("user.name", "t");
    writeFileSync(join(repo, "README.md"), "base\n");
    await g.add(".");
    await g.commit("init");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  function cycle(tracker: FlowTracker, flowId: string, harnessStamp?: () => Promise<HarnessStamp | undefined>): DevCycle {
    return new DevCycle({
      store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
      ws: new Workspace(repo),
      runner: new FakeRunner({
        spec: { text: "## acceptance\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"" } },
        implement: { text: "done", meta: {} },
      }),
      flowId,
      tracker,
      ...(harnessStamp ? { harnessStamp } : {}),
    });
  }

  it("带 harnessStamp → 状态里有同值 harness", async () => {
    const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
    const stamp: HarnessStamp = { gitSha: "abc", dirty: false, gateHash: "f".repeat(64), at: 42 };
    await cycle(tracker, "harness-ok", async () => stamp).run("记 harness");
    expect((await tracker.read("harness-ok"))!.harness).toEqual(stamp);
  });

  it("harnessStamp 抛错 → 流照常跑完，无 harness 字段", async () => {
    const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
    await cycle(tracker, "harness-err", async () => { throw new Error("boom"); }).run("记 harness 失败");
    const state = (await tracker.read("harness-err"))!;
    expect(state.harness).toBeUndefined();
    expect(state.history.length).toBeGreaterThan(1);
  });
});

describe("plan 编排器接线（源码锚点）", () => {
  it("plan/orchestrator.ts 的 DevCycle 传 harnessStamp", () => {
    const src = readFileSync(join(SRC, "plan", "orchestrator.ts"), "utf8");
    expect(src).toContain("harnessStamp: () => computeHarnessStamp(defaultOrchestratorRoot()),");
  });
});