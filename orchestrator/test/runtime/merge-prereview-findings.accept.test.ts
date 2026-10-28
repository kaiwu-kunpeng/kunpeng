import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { mergeAndClearGate } from "../../src/runtime/merge-gate.js";
import { PRE_REVIEW_NORMAL_ISSUE_PREFIX, isObservableMergeFinding, reviewMergeDiff, type MergeReviewContext } from "../../src/runtime/merge-review.js";
import {
  MERGE_FINDINGS_RULE, MERGE_FINDINGS_SCHEMA, MERGE_PROJECT_RULES_LABEL, loadProjectReviewRules, normalizeFindings, preReviewMerge,
} from "../../src/server/pre-review.js";

// 背景（2026-10-03 运营审计 K5 / 总报告 P1-6）：合并预审只回一个 verdict 字，reviewMerge 确定性门读不到任何"为什么"，
// 人在收件箱里只看到「reject：改动有风险」。本测试锁定：预审输出固定三桶 findings（normal/nit/pre_existing），
// 每条必须 file:line + 实跑证据、缺项即丢；approve 与 normal 矛盾降级 review；每托管项目 REVIEW.md 进提示词；
// reviewMerge 把 normal 桶当确定性拦截（error）、nit→warn、pre_existing→info；合并门把门上落盘的预审喂给 reviewMerge。

function runnerSaying(text: string) {
  const seen: string[] = [];
  const runner = { run: async (req: { system: string }) => { seen.push(req.system); return { text }; } } as unknown as Parameters<typeof preReviewMerge>[1];
  return { runner, seen };
}
const normal = { file: "src/a.ts", line: 12, issue: "新增分支吞掉异常", evidence: "+ } catch { return undefined; }" };
const nit = { file: "src/a.ts", line: 30, issue: "命名可更贴切", evidence: "+ const tmp = ..." };
const pre = { file: "src/b.ts", line: 5, issue: "旧有 any", evidence: "main 上已存在" };

describe("预审 findings 契约（作者锁定）", () => {
  it("解析三桶；缺 line/evidence 的条目丢弃；提示词带 schema+规则+REVIEW.md", async () => {
    const payload = JSON.stringify({ verdict: "reject", reason: "有必须修的问题", findings: { normal: [normal, { file: "src/c.ts", issue: "没行号", evidence: "x" }], nit: [nit, { file: "src/d.ts", line: 3, issue: "没证据" }], pre_existing: [pre] } });
    const { runner, seen } = runnerSaying(payload);
    const pr = await preReviewMerge("diff --git a b", runner, () => 7, "验收：xx", "# 本项目规则\n不许吞异常");
    expect(pr.verdict).toBe("reject");
    expect(pr.findings).toEqual({ normal: [normal], nit: [nit], pre_existing: [pre] });
    expect(seen[0]).toContain(MERGE_FINDINGS_SCHEMA);
    expect(seen[0]).toContain(MERGE_FINDINGS_RULE);
    expect(seen[0]).toContain(`${MERGE_PROJECT_RULES_LABEL}\n# 本项目规则\n不许吞异常`);
    const { seen: noRules } = runnerSaying(payload);
    await preReviewMerge("diff --git a b", runnerSaying(payload).runner, () => 7);
    expect(noRules).toEqual([]);
    expect(normalizeFindings(undefined)).toEqual({ normal: [], nit: [], pre_existing: [] });
    expect(normalizeFindings({ normal: "not-array", nit: [{ file: "", line: 1, issue: "i", evidence: "e" }] })).toEqual({ normal: [], nit: [], pre_existing: [] });
  });

  it("approve 却带 normal 发现 → 降级 review；无 findings 字段 → 三桶空且 approve 保留", async () => {
    const down = await preReviewMerge("d", runnerSaying(JSON.stringify({ verdict: "approve", reason: "看着行", findings: { normal: [normal] } })).runner, () => 1);
    expect(down.verdict).toBe("review");
    expect(down.reason).toContain("降级为 review");
    const ok = await preReviewMerge("d", runnerSaying('{"verdict":"approve","reason":"改动小"}').runner, () => 1);
    expect(ok.verdict).toBe("approve");
    expect(ok.findings).toEqual({ normal: [], nit: [], pre_existing: [] });
  });

  it("loadProjectReviewRules：有 REVIEW.md 读正文，没有返回 undefined", async () => {
    const root = mkdtempSync(join(tmpdir(), "kp-review-rules-"));
    expect(await loadProjectReviewRules(root)).toBeUndefined();
    writeFileSync(join(root, "REVIEW.md"), "  # 规则\n禁止 any  \n");
    expect(await loadProjectReviewRules(root)).toBe("# 规则\n禁止 any");
    rmSync(root, { recursive: true, force: true });
  });

  it("reviewMergeDiff：normal→error 拦、nit→warn、pre_existing→info；无预审时行为不变；normal 发现可观察", () => {
    const diff = ["diff --git a/src/a.ts b/src/a.ts", "index 1..2 100644", "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    const base = { repoRoot: "/tmp/repo", flowId: "f1", base: "main", diff };
    expect(reviewMergeDiff(base)).toMatchObject({ block: false, details: [] });
    const blocked = reviewMergeDiff({ ...base, preReview: { verdict: "review", reason: "r", findings: { normal: [normal], nit: [nit], pre_existing: [pre, { file: "", line: 0, issue: "", evidence: "" }] } } });
    expect(blocked.block).toBe(true);
    expect(blocked.details.map((d) => [d.severity, d.file])).toEqual([["error", "src/a.ts:12"], ["warn", "src/a.ts:30"], ["info", "src/b.ts:5"]]);
    expect(blocked.details[0]!.issue).toBe(`${PRE_REVIEW_NORMAL_ISSUE_PREFIX}新增分支吞掉异常`);
    expect(blocked.details[0]!.evidence).toBe(normal.evidence);
    expect(blocked.findings).toEqual([`src/a.ts:12: ${PRE_REVIEW_NORMAL_ISSUE_PREFIX}新增分支吞掉异常 (${normal.evidence})`]);
    expect(isObservableMergeFinding(blocked.details[0]!)).toBe(true);
    const soft = reviewMergeDiff({ ...base, preReview: { verdict: "approve", reason: "r", findings: { nit: [nit] } } });
    expect(soft.block).toBe(false);
    expect(soft.details.map((d) => d.severity)).toEqual(["warn"]);
  });
});

describe("合并门把门上预审喂给审查（作者锁定）", () => {
  let repo: string;
  let prevState: string | undefined;
  let prevInstance: string | undefined;
  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    repo = mkdtempSync(join(tmpdir(), "kp-mg-prereview-"));
    prevState = process.env.KUNPENG_STATE; prevInstance = process.env.KUNPENG_INSTANCE;
    process.env.KUNPENG_STATE = join(repo, "global-state"); process.env.KUNPENG_INSTANCE = "merge-prereview-test";
    mkdirSync(process.env.KUNPENG_STATE, { recursive: true });
    const g = simpleGit(repo);
    await g.init(); await g.addConfig("user.email", "t@t").addConfig("user.name", "t");
    await g.checkoutLocalBranch("main");
    writeFileSync(join(repo, "a.txt"), "base"); await g.add("a.txt"); await g.commit("base");
    await g.checkoutLocalBranch("kp/f1");
    writeFileSync(join(repo, "src.ts"), "export const v = 1;\n"); await g.add("src.ts"); await g.commit("feat on f1");
    await g.checkout("main");
    const t = new FlowTracker(join(repo, ".kunpeng", "state"));
    await t.start("f1", "造门用");
    await t.finish("f1", "verified", { gate: "合并主干 (人工门#1)", what: "kp/f1 → main" });
    await t.setGatePreReview("f1", { verdict: "review", reason: "有 normal 发现", at: 9, findings: { normal: [{ ...normal, file: "src.ts", line: 1 }], nit: [], pre_existing: [] } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (prevState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = prevState;
    if (prevInstance === undefined) delete process.env.KUNPENG_INSTANCE; else process.env.KUNPENG_INSTANCE = prevInstance;
    rmSync(repo, { recursive: true, force: true });
  });

  it("review 钩子收到 ctx.preReview（含 findings）；默认审查据 normal 发现拦合并、gateHold=review-block", async () => {
    const review = vi.fn(async (_ctx: MergeReviewContext) => ({ block: true, findings: ["stop"], details: [] }));
    await mergeAndClearGate(repo, "f1", "main", { guardTests: false, stopCheckpoint: false, review });
    expect(review).toHaveBeenCalledTimes(1);
    expect(review.mock.calls[0]![0].preReview?.findings?.normal).toHaveLength(1);

    const r = await mergeAndClearGate(repo, "f1", "main", { guardTests: false, stopCheckpoint: false });
    expect(r.ok).toBe(false);
    expect(r.error).toContain(`src.ts:1: ${PRE_REVIEW_NORMAL_ISSUE_PREFIX}新增分支吞掉异常`);
    expect(await simpleGit(repo).raw(["branch", "--merged", "main"])).not.toContain("kp/f1");
    const s = (await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!;
    expect(s.humanGate).toBeDefined();
    expect(s.gateHold?.kind).toBe("review-block");
  });
});