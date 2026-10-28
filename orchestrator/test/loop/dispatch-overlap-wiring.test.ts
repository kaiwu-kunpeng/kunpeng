import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FakeRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

const SRC = join(process.cwd(), "src");

describe("FlowState.predictedFiles 随 start 落盘(作者锁定)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-overlap-state-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("tracker.start 带 predictedFiles → read 取回;不带则无该字段;startOrResume 不带时保留既有值", async () => {
    const t = new FlowTracker(dir);
    await t.start("f1", "需求", { predictedFiles: ["orchestrator/src/a.ts", "orchestrator/test/a.test.ts"] });
    expect((await t.read("f1"))!.predictedFiles).toEqual(["orchestrator/src/a.ts", "orchestrator/test/a.test.ts"]);
    await t.start("f2", "需求");
    expect((await t.read("f2"))!.predictedFiles).toBeUndefined();
    await t.startOrResume("f1", "需求", { logPath: "/tmp/x.log" });
    expect((await t.read("f1"))!.predictedFiles).toEqual(["orchestrator/src/a.ts", "orchestrator/test/a.test.ts"]);
  });
});

describe("DevCycle 把 predictedFiles 透传给 tracker.start(作者锁定)", () => {
  let repo: string;
  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), "kp-overlap-devcycle-"));
    const g = simpleGit(repo);
    await g.init();
    await g.addConfig("user.email", "t@t.t");
    await g.addConfig("user.name", "t");
    writeFileSync(join(repo, "README.md"), "base\n");
    await g.add(".");
    await g.commit("init");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  test("run 后 state.predictedFiles 等于传入值", async () => {
    const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
    const dc = new DevCycle({
      store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
      ws: new Workspace(repo),
      runner: new FakeRunner({
        spec: { text: "## acceptance\n- ok", meta: { testCmd: "node -e \"process.exit(0)\"" } },
        implement: { text: "done", meta: {} },
      }),
      flowId: "overlap-passthrough",
      tracker,
      predictedFiles: ["orchestrator/src/loop/x.ts"],
    });
    await dc.run("透传预测集");
    expect((await tracker.read("overlap-passthrough"))!.predictedFiles).toEqual(["orchestrator/src/loop/x.ts"]);
  });
});

describe("run 入口接线(源码锚点,作者锁定)", () => {
  test("devcycle.ts 在 run 命令里、new DevCycle 之前调用 precheckDispatchOverlap,并把 predictedFiles 传给 DevCycle", () => {
    const src = readFileSync(join(SRC, "cli-commands", "devcycle.ts"), "utf8");
    expect(src).toContain('import { precheckDispatchOverlap } from "../loop/dispatch-overlap.js";');
    const call = "const precheck = await precheckDispatchOverlap({ flowId, requirement, scopeAllow, tracker, repoRoot: context.repoRoot });";
    const runIdx = src.indexOf('name: "run",');
    const callIdx = src.indexOf(call);
    const dcIdx = src.indexOf("const dc = new DevCycle({", runIdx);
    const runEnd = src.indexOf("registerCliCommand({", runIdx + 1);
    expect(runIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(runIdx);
    expect(callIdx).toBeLessThan(dcIdx);
    expect(dcIdx).toBeLessThan(runEnd);
    expect(src.slice(dcIdx, runEnd)).toContain("...(precheck.predictedFiles.length ? { predictedFiles: precheck.predictedFiles } : {}),");
    // 只接 run,不碰 resume / plan:调用点恰一处(import 行不含左括号)
    expect(src.split("precheckDispatchOverlap(").length - 1).toBe(1);
  });

  test("dev-cycle.ts 的 start 调用带 predictedFiles;flowstate.ts 有可选字段", () => {
    const dc = readFileSync(join(SRC, "loop", "dev-cycle.ts"), "utf8");
    expect(dc).toContain("predictedFiles?: string[];");
    expect(dc).toContain("...(this.d.predictedFiles?.length ? { predictedFiles: this.d.predictedFiles } : {}),");
    const fs = readFileSync(join(SRC, "runtime", "flowstate.ts"), "utf8");
    expect(fs).toContain("predictedFiles?: string[];");
    expect(fs).toMatch(/export type FlowStartExtra = Pick<FlowState, "planId" \| "phase" \| "logPath" \| "profileId" \| "predictedFiles">;/);
  });
});