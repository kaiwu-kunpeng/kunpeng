import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildNorthstar, classifyMerge, formatNorthstarReport, gitLogsForNorthstar, type NorthstarFlow } from "../../src/metrics/northstar.js";
import { parseMergedRecordsFromGitLog } from "../../src/metrics/flow-records.js";
import type { GateLedgerEntry } from "../../src/runtime/flowstate.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 18, 12);
const entry = (over: Partial<GateLedgerEntry>): GateLedgerEntry => ({
  gate: "合并主干 (人工门#1)", what: "kp/x → main", openedAt: NOW - 30 * DAY, closedAt: NOW - 29 * DAY, durationMs: 60_000,
  by: "machine", via: "autopilot-cli", planGate: false, ...over,
});

describe("classifyMerge", () => {
  it("账本空 → bypass；没有流状态也是 bypass", () => {
    expect(classifyMerge("a", [{ flowId: "a", gateLedger: [] }]).kind).toBe("bypass");
    expect(classifyMerge("ghost", []).kind).toBe("bypass");
  });
  it("任一 human 条目 → human，并计人工介入次数", () => {
    const r = classifyMerge("a", [{ flowId: "a", gateLedger: [entry({ by: "human", closedAt: 1 }), entry({ by: "machine", closedAt: 2 }), entry({ by: "human", closedAt: 3 })] }]);
    expect(r).toEqual({ kind: "human", humanTouches: 2, sensitive: false });
  });
  it("无 human 时取最后清门者", () => {
    expect(classifyMerge("a", [{ flowId: "a", gateLedger: [entry({ by: "agent", closedAt: 5 }), entry({ by: "machine", closedAt: 2 })] }]).kind).toBe("agent");
    expect(classifyMerge("a", [{ flowId: "a", gateLedger: [entry({ by: "unknown", closedAt: 9 }), entry({ by: "machine", closedAt: 2 })] }]).kind).toBe("unknown");
  });
  it("plan 子流的账本与敏感标记算进 plan", () => {
    const flows: NorthstarFlow[] = [
      { flowId: "plan-1", gateLedger: [entry({ by: "agent", closedAt: 10 })] },
      { flowId: "child", planId: "plan-1", gateLedger: [entry({ by: "human", closedAt: 4 })], sensitive: { hits: [{ file: "x", label: "y" }] } },
      { flowId: "other", gateLedger: [entry({ by: "human" })], sensitive: { hits: [{}] } },
    ];
    expect(classifyMerge("plan-1", flows)).toEqual({ kind: "human", humanTouches: 1, sensitive: true });
  });
});

describe("buildNorthstar", () => {
  const flows: NorthstarFlow[] = [
    { flowId: "m-old", gateLedger: [entry({ by: "machine" })] },
    { flowId: "a-old", gateLedger: [entry({ by: "agent" })], sensitive: { hits: [{}] } },
    { flowId: "h-old", gateLedger: [entry({ by: "human" }), entry({ by: "human" })] },
    { flowId: "rev-old", gateLedger: [entry({ by: "machine" })] },
    { flowId: "m-new", gateLedger: [entry({ by: "machine" })], sensitive: { hits: [{}] } },
    { flowId: "bp-new", gateLedger: [] },
  ];
  const merges = [
    { flowId: "m-old", mergedAt: NOW - 20 * DAY },
    { flowId: "a-old", mergedAt: NOW - 16 * DAY },
    { flowId: "h-old", mergedAt: NOW - 15 * DAY },
    { flowId: "rev-old", mergedAt: NOW - 19 * DAY },
    { flowId: "m-new", mergedAt: NOW - 2 * DAY },
    { flowId: "bp-new", mergedAt: NOW - 1 * DAY },
    { flowId: "too-old", mergedAt: NOW - 40 * DAY },
  ];
  const weeks = buildNorthstar(merges, ["rev-old"], flows, { now: NOW, weeks: 4 });

  it("由旧到新 4 周、区间正确、空周补零", () => {
    expect(weeks).toHaveLength(4);
    expect(weeks[3].weekEnd).toBe(NOW);
    expect(weeks[3].weekStart).toBe(NOW - 7 * DAY);
    expect(weeks[0].weekStart).toBe(NOW - 28 * DAY);
    expect(weeks[0].merges).toBe(0);
    expect(weeks[0].northstar).toBe(0);
  });
  it("满 14 天且未 revert 的 machine/agent 计入北极星", () => {
    const w = weeks[1]; // [NOW-21d, NOW-14d)
    expect(weeks[2].merges).toBe(0);
    expect(w.merges).toBe(4);
    expect(w.machine).toBe(2);
    expect(w.agent).toBe(1);
    expect(w.human).toBe(1);
    expect(w.humanTouches).toBe(2);
    expect(w.reverted).toBe(1);
    expect(w.northstar).toBe(2);
    expect(w.pendingMaturity).toBe(0);
    expect(w.sensitiveByAgent).toBe(1);
    expect(w.sensitiveByMachine).toBe(0);
  });
  it("未满 14 天计入待满；绕门与机器合入敏感单列", () => {
    const w = weeks[3];
    expect(w.merges).toBe(2);
    expect(w.northstar).toBe(0);
    expect(w.pendingMaturity).toBe(1);
    expect(w.bypass).toBe(1);
    expect(w.sensitiveByMachine).toBe(1);
  });
  it("报告含标题、护栏字段与机器敏感告警", () => {
    const text = formatNorthstarReport(weeks, "kunpeng");
    expect(text).toContain("北极星：无人介入且满 14 天未 revert 的合入／周");
    expect(text).toContain("kunpeng");
    for (const key of ["北极星 2", "待满14天 1", "人工介入 2", "绕门 1", "revert 1", "敏感合入 machine 1/agent 0/human 0"]) expect(text).toContain(key);
    expect(text).toContain(new Date(NOW - 21 * DAY).toISOString().slice(0, 10));
    expect(text).toContain("⚠️ 机器自动合入了敏感改动");
    const quiet = formatNorthstarReport(buildNorthstar([], [], [], { now: NOW, weeks: 2 }));
    expect(quiet).not.toContain("⚠️");
  });
});

describe("gitLogsForNorthstar 只数第一父合并（真 git）", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "kp-northstar-"));
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, "a.txt"), "a\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "kp/plan-x");
    git("checkout", "-qb", "kp/child-0-0");
    writeFileSync(join(repo, "b.txt"), "b\n");
    git("add", ".");
    git("commit", "-qm", "child");
    git("checkout", "-q", "kp/plan-x");
    git("merge", "-q", "--no-ff", "-m", "Merge branch 'kp/child-0-0' into HEAD", "kp/child-0-0");
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "-m", "Merge branch 'kp/plan-x'", "kp/plan-x");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("plan 内嵌子流合并只算 plan 一次", async () => {
    const { mergedLog } = await gitLogsForNorthstar(repo);
    expect(parseMergedRecordsFromGitLog(mergedLog).map((r) => r.flowId)).toEqual(["plan-x"]);
  });
  it("仓库不存在时返回空串", async () => {
    expect(await gitLogsForNorthstar(join(repo, "nope"))).toEqual({ mergedLog: "", revertLog: "" });
  });
});

describe("CLI 注册", () => {
  it("reports.ts 注册了 northstar 命令并用 gitLogsForNorthstar", () => {
    const src = readFileSync(new URL("../../src/cli-commands/reports.ts", import.meta.url), "utf8");
    expect(src).toMatch(/name:\s*"northstar"/);
    expect(src).toContain("gitLogsForNorthstar");
  });
});