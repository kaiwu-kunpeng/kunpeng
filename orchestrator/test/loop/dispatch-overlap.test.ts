import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import {
  OVERLAP_STRICT_EXIT_CODE,
  overlapWithRunning,
  precheckDispatchOverlap,
  predictTouchedFiles,
  runningFlowFiles,
  type RunningFlowSource,
} from "../../src/loop/dispatch-overlap.js";

const flow = (flowId: string, status: "running" | "verified" | "crashed", extra: { agentActive?: boolean; predictedFiles?: string[] } = {}) =>
  ({ flowId, status, agentActive: extra.agentActive ?? false, ...(extra.predictedFiles ? { predictedFiles: extra.predictedFiles } : {}) });

// 三反引号用拼接写,避免本文件被 spec 的 ts path= 围栏提取正则截断。
const FENCE = "`".repeat(3);

const fakeTracker = (flows: ReturnType<typeof flow>[]): RunningFlowSource => ({ list: async () => flows });

describe("predictTouchedFiles:从 scope allow 与正文抽精确路径(作者锁定)", () => {
  test("allow 里的精确路径入选,含通配的 glob 不入选;正文里 orchestrator/…(ts|md|json) 路径入选;去重保序", () => {
    const requirement = [
      "改 orchestrator/src/loop/a.ts 与 orchestrator/test/loop/a.test.ts,再改一次 orchestrator/src/loop/a.ts。",
      `${FENCE}ts path=orchestrator/test/loop/b.test.ts`,
      "export {};",
      FENCE,
      "配置在 orchestrator/package.json;文档 orchestrator/docs/x.md;不是路径的 orchestrator/src/loop/a.js 不算。",
    ].join("\n");
    const out = predictTouchedFiles({
      scopeAllow: ["orchestrator/src/loop/a.ts", "./orchestrator/src/loop/c.ts", "orchestrator/src/**/*.ts", "orchestrator/test/loop/*.test.ts"],
      requirement,
    });
    expect(out).toEqual([
      "orchestrator/src/loop/a.ts",
      "orchestrator/src/loop/c.ts",
      "orchestrator/test/loop/a.test.ts",
      "orchestrator/test/loop/b.test.ts",
      "orchestrator/package.json",
      "orchestrator/docs/x.md",
    ]);
  });

  test("否定行(禁止/不改/不动)里的路径与 scope forbid 精确路径不计入", () => {
    const requirement = [
      "改 orchestrator/src/loop/a.ts。",
      "不改 orchestrator/src/server/chat-stream.ts;禁止动 orchestrator/src/loop/dev-cycle.ts。",
      `${FENCE}scope`,
      "allow:",
      "  - orchestrator/src/loop/a.ts",
      "  - orchestrator/src/loop/d.ts",
      "forbid:",
      "  - orchestrator/src/loop/d.ts",
      FENCE,
    ].join("\n");
    expect(predictTouchedFiles({ scopeAllow: ["orchestrator/src/loop/a.ts", "orchestrator/src/loop/d.ts"], requirement }))
      .toEqual(["orchestrator/src/loop/a.ts"]);
  });

  test("无 scope、正文无路径 → 空数组;非法输入不抛", () => {
    expect(predictTouchedFiles({ requirement: "给对话加个导出按钮" })).toEqual([]);
    expect(predictTouchedFiles({ scopeAllow: [], requirement: "" })).toEqual([]);
  });
});

describe("overlapWithRunning:精确路径相等即重叠,glob 不参与(作者锁定)", () => {
  test("只返回有撞文件的流,files 按 candidate 顺序", () => {
    const out = overlapWithRunning(
      ["orchestrator/src/a.ts", "orchestrator/src/b.ts", "orchestrator/src/c.ts"],
      [
        { flowId: "f1", files: ["orchestrator/src/c.ts", "orchestrator/src/a.ts"] },
        { flowId: "f2", files: ["orchestrator/src/z.ts"] },
        { flowId: "f3", files: ["orchestrator/src/**/*.ts"] },
        { flowId: "f4", files: ["./orchestrator/src/b.ts"] },
      ],
    );
    expect(out).toEqual([
      { flowId: "f1", files: ["orchestrator/src/a.ts", "orchestrator/src/c.ts"] },
      { flowId: "f4", files: ["orchestrator/src/b.ts"] },
    ]);
  });

  test("candidate 为空或 running 为空 → 空", () => {
    expect(overlapWithRunning([], [{ flowId: "f1", files: ["a"] }])).toEqual([]);
    expect(overlapWithRunning(["a"], [])).toEqual([]);
  });
});

describe("runningFlowFiles:predictedFiles 优先,否则读 kp/<flowId> 相对 main 的 diff;分支不存在返回空不抛", () => {
  let dir: string;
  let git: SimpleGit;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "kp-dispatch-overlap-"));
    git = simpleGit(dir);
    await git.init();
    await git.addConfig("user.email", "t@t.t");
    await git.addConfig("user.name", "t");
    await git.checkoutLocalBranch("main");
    writeFileSync(join(dir, "README.md"), "base\n");
    await git.add(".");
    await git.commit("init");
    await git.checkoutBranch("kp/with-branch", "main");
    writeFileSync(join(dir, "orchestrator-src-x.ts"), "x\n");
    writeFileSync(join(dir, "README.md"), "changed\n");
    await git.add(".");
    await git.commit("branch work");
    await git.checkout("main");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("running 流:有 predictedFiles 用之;无则 git diff;分支不存在 → [];非 running 且非 agentActive 的流被忽略", async () => {
    const tracker = fakeTracker([
      flow("with-branch", "running"),
      flow("predicted", "running", { predictedFiles: ["orchestrator/src/p.ts"] }),
      flow("no-branch", "running"),
      flow("active-but-verified", "verified", { agentActive: true }),
      flow("done", "verified"),
      flow("dead", "crashed"),
    ]);
    const out = await runningFlowFiles(tracker, dir);
    expect(out).toEqual([
      { flowId: "with-branch", files: ["README.md", "orchestrator-src-x.ts"] },
      { flowId: "predicted", files: ["orchestrator/src/p.ts"] },
      { flowId: "no-branch", files: [] },
      { flowId: "active-but-verified", files: [] },
    ]);
  });

  test("repoRoot 不是 git 仓库 / tracker.list 抛 → 不抛", async () => {
    const notRepo = mkdtempSync(join(tmpdir(), "kp-dispatch-overlap-norepo-"));
    try {
      await expect(runningFlowFiles(fakeTracker([flow("x", "running")]), notRepo)).resolves.toEqual([{ flowId: "x", files: [] }]);
      await expect(runningFlowFiles({ list: async () => { throw new Error("boom"); } }, dir)).resolves.toEqual([]);
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });

  test("precheckDispatchOverlap:默认只告警继续;严格模式 exit(4) 拒派;排除自己", async () => {
    const lines: string[] = [];
    const exits: number[] = [];
    const tracker = fakeTracker([
      flow("with-branch", "running"),
      flow("other", "running", { predictedFiles: ["orchestrator/src/loop/a.ts", "orchestrator/src/loop/b.ts"] }),
      flow("self", "running", { predictedFiles: ["orchestrator/src/loop/a.ts"] }),
    ]);
    const base = { flowId: "self", requirement: "改 orchestrator/src/loop/a.ts 和 README.md", scopeAllow: ["README.md", "orchestrator/src/**"], tracker, repoRoot: dir, log: (l: string) => lines.push(l), exit: (c: number) => exits.push(c) };

    const warn = await precheckDispatchOverlap({ ...base, strict: false });
    expect(warn.predictedFiles).toEqual(["README.md", "orchestrator/src/loop/a.ts"]);
    expect(warn.overlaps).toEqual([
      { flowId: "with-branch", files: ["README.md"] },
      { flowId: "other", files: ["orchestrator/src/loop/a.ts"] },
    ]);
    expect(warn.refused).toBe(false);
    expect(exits).toEqual([]);
    expect(lines).toContain("[派流预检] 与在跑流 with-branch 撞文件: README.md");
    expect(lines).toContain("[派流预检] 与在跑流 other 撞文件: orchestrator/src/loop/a.ts");
    expect(lines.some((l) => l.includes("与在跑流 self"))).toBe(false);

    lines.length = 0;
    const strict = await precheckDispatchOverlap({ ...base, strict: true });
    expect(strict.refused).toBe(true);
    expect(exits).toEqual([OVERLAP_STRICT_EXIT_CODE]);
    expect(OVERLAP_STRICT_EXIT_CODE).toBe(4);
    expect(lines.some((l) => l.includes("KUNPENG_OVERLAP_STRICT=1") && l.includes("拒派"))).toBe(true);

    lines.length = 0;
    exits.length = 0;
    const clean = await precheckDispatchOverlap({ ...base, requirement: "改 orchestrator/src/loop/z.ts", scopeAllow: undefined, strict: true });
    expect(clean.overlaps).toEqual([]);
    expect(clean.refused).toBe(false);
    expect(exits).toEqual([]);
    expect(lines).toEqual(["[派流预检] 预测触及 1 个文件,与 2 条在跑流无重叠"]);
  });
});