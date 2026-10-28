import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  computeSuspectedEscapes,
  formatSuspectedEscapes,
  gitMergedFlowChanges,
  isProductSource,
  titleOf,
  type MergedFlowChange,
} from "../../src/metrics/suspected-escape.js";

const DAY = 86_400_000;
const change = (flowId: string, day: number, files: string[], title: string): MergedFlowChange => ({ flowId, mergedAt: day * DAY, files, title });

describe("疑似逃逸判定（作者锁定）", () => {
  test("7 天内修复类后续流改了同一源码文件 → A 记疑似逃逸，带出 B 与重叠文件", () => {
    const out = computeSuspectedEscapes([
      change("a", 1, ["orchestrator/src/x.ts", "docs/a.md"], "加导出按钮"),
      change("b", 3, ["orchestrator/src/x.ts"], "修复导出按钮的回归"),
    ]);
    expect(out).toEqual([{ flowId: "a", laterFlowId: "b", files: ["orchestrator/src/x.ts"] }]);
  });

  test("不算：超出 7 天、后续流不是修复类、只重叠测试或文档、同一流", () => {
    expect(computeSuspectedEscapes([change("a", 1, ["src/x.ts"], "加功能"), change("b", 9, ["src/x.ts"], "fix x")])).toEqual([]);
    expect(computeSuspectedEscapes([change("a", 1, ["src/x.ts"], "加功能"), change("b", 2, ["src/x.ts"], "再加一个功能")])).toEqual([]);
    expect(computeSuspectedEscapes([change("a", 1, ["src/x.test.ts", "docs/x.md"], "加功能"), change("b", 2, ["src/x.test.ts", "docs/x.md"], "修复测试")])).toEqual([]);
    expect(computeSuspectedEscapes([change("a", 1, ["src/x.ts"], "修复 x"), change("a", 2, ["src/x.ts"], "修复 x")])).toEqual([]);
  });

  test("修复类字样中英都认；产品源码判定；标题只取第一行", () => {
    for (const t of ["Fix login", "hotfix: x", "修正统计", "回归：导出", "bug in parser", "返工 y"]) {
      expect(computeSuspectedEscapes([change("a", 1, ["src/x.ts"], "加"), change("b", 2, ["src/x.ts"], t)])).toHaveLength(1);
    }
    expect(computeSuspectedEscapes([change("a", 1, ["src/x.ts"], "加"), change("b", 2, ["src/x.ts"], "prefix 调整")])).toEqual([]);
    expect(isProductSource("orchestrator/src/a/b.ts")).toBe(true);
    expect(isProductSource("orchestrator/src/a/b.test.ts")).toBe(false);
    expect(isProductSource("orchestrator/test/a.ts")).toBe(false);
    expect(titleOf("\n# 修登录超时\n\n**背景** 修复了很多东西")).toBe("修登录超时");
  });

  test("报告行：计数、比例、明细", () => {
    const text = formatSuspectedEscapes(40, [{ flowId: "a", laterFlowId: "b", files: ["src/x.ts"] }]);
    expect(text.split("\n")[0]).toContain("suspected");
    expect(text.split("\n")[0]).toContain("1 / 40（2.5%）");
    expect(text).toContain("- a ← b（src/x.ts）");
  });
});

describe("从真 git 历史取合并与文件（作者锁定）", () => {
  let repo: string;
  const git = (args: string[], at?: number) => execFileSync("git", args, {
    cwd: repo,
    env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: `@${at} +0000`, GIT_COMMITTER_DATE: `@${at} +0000` } : {}) },
    stdio: "pipe",
  }).toString();
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "kp-suspect-"));
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "x.ts"), "export const x = 1;\n");
    git(["add", "."]);
    git(["commit", "-qm", "base"], 1_000);
    const flow = (id: string, content: string, at: number) => {
      git(["checkout", "-qb", `kp/${id}`]);
      writeFileSync(join(repo, "src", "x.ts"), content);
      git(["commit", "-qam", `kp(${id}): verified`], at);
      git(["checkout", "-q", "main"]);
      git(["merge", "--no-ff", "-q", "-m", `Merge branch 'kp/${id}'`, `kp/${id}`], at + 10);
    };
    flow("feat-a", "export const x = 2;\n", 10 * 86_400);
    flow("fix-b", "export const x = 3;\n", 12 * 86_400);
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  test("只取 first-parent 上的 kp/ 合并，时间、文件、标题都对；端到端算出疑似逃逸", async () => {
    const titles: Record<string, string> = { "feat-a": "加 x", "fix-b": "修复 x 的回归" };
    const changes = await gitMergedFlowChanges(repo, { sinceMs: 0, titleFor: (id) => titles[id] });
    expect(changes.map((c) => [c.flowId, c.mergedAt, c.files, c.title]).sort()).toEqual([
      ["feat-a", (10 * 86_400 + 10) * 1000, ["src/x.ts"], "加 x"],
      ["fix-b", (12 * 86_400 + 10) * 1000, ["src/x.ts"], "修复 x 的回归"],
    ]);
    expect(computeSuspectedEscapes(changes)).toEqual([{ flowId: "feat-a", laterFlowId: "fix-b", files: ["src/x.ts"] }]);
    expect(await gitMergedFlowChanges(repo, { sinceMs: 11 * 86_400_000, titleFor: () => undefined })).toHaveLength(1);
  });
});

describe("escape-rate 报告接上第二列（作者锁定，源码形状）", () => {
  test("reports.ts 的 escape-rate 调了 gitMergedFlowChanges 与 formatSuspectedEscapes", () => {
    const src = readFileSync(new URL("../../src/cli-commands/reports.ts", import.meta.url), "utf8");
    const block = src.slice(src.indexOf('name: "escape-rate"'));
    expect(block).toContain("gitMergedFlowChanges(");
    expect(block).toContain("formatSuspectedEscapes(");
    expect(block).toContain("computeSuspectedEscapes(");
  });
});