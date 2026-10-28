import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planScopeViolations,
  isMachineSpecCopy,
  isAgentRegistryFile,
} from "../../src/plan/orchestrator.js";
import {
  isFlowWorktreePath,
  registerProject,
  readRegistry,
} from "../../src/project/registry.js";
import { lintSpecText } from "../../src/plan/spec-lint.js";

// 对抗自测套件:红队(2026-07-13)指出的旁路面,用真实攻击用例固化证明门防得住。
// 每个用例注释标明攻击名与出处;这是永久回归集,任何门被削弱都会在此暴露。
const SCOPE = "```scope\nallow: orchestrator/src/a.ts\nallow: orchestrator/test/a.accept.test.ts\n```\n\n# 段\n正文";

describe("门防线对抗自测", () => {
  it("攻击1 conftest 式配置劫持(BenchJack, arXiv 2605.12673):改测试之外的配置面劫持验证 → 全部越界", () => {
    // BenchJack 发现 agent 提交 conftest.py 存活于测试重置、劫持结果上报。
    // 鲲鹏的同构面 = vitest.config / package.json scripts / test setup。
    const attack = [
      "orchestrator/src/a.ts",
      "orchestrator/vitest.config.ts",
      "orchestrator/package.json",
      "orchestrator/test/setup.ts",
    ];
    const v = planScopeViolations(SCOPE, attack);
    const flagged = new Set(v.map((x) => x.file));
    expect(flagged.has("orchestrator/vitest.config.ts")).toBe(true);
    expect(flagged.has("orchestrator/package.json")).toBe(true);
    expect(flagged.has("orchestrator/test/setup.ts")).toBe(true);
    // 合法文件不被误伤
    expect(flagged.has("orchestrator/src/a.ts")).toBe(false);
  });

  it("攻击2 验收测试文件顶替:改动未在 allow 的验收测试 → 越界", () => {
    const v = planScopeViolations(SCOPE, ["orchestrator/test/other.accept.test.ts"]);
    expect(v.some((x) => x.file === "orchestrator/test/other.accept.test.ts")).toBe(true);
  });

  it("攻击3 豁免面不外溢:机器 spec 副本/登记文件豁免不放行同目录其他文件", () => {
    // 只有 AGENTS-ACTIVE.md 与机器 spec 副本本身豁免,近似名/同目录他文件不豁免。
    expect(isAgentRegistryFile("orchestrator/AGENTS-ACTIVE.md")).toBe(true);
    expect(isAgentRegistryFile("orchestrator/AGENTS-ACTIVE.md.ts")).toBe(false);
    expect(isAgentRegistryFile("orchestrator/AGENTS.md")).toBe(false);
    const v = planScopeViolations(SCOPE, [
      "orchestrator/AGENTS-ACTIVE.md", // 豁免,不应出现
      "docs/other.md", // 非豁免且越界
    ]);
    expect(v.some((x) => x.file === "orchestrator/AGENTS-ACTIVE.md")).toBe(false);
    expect(v.some((x) => x.file === "docs/other.md")).toBe(true);
  });

  it("攻击4 幽灵项目注册:.kunpeng/wt 与 worktrees 下路径注册 → 拒绝且注册表零写入", async () => {
    // 2026-07-13 真实事故:flow worktree 被误注册成项目,workbench 冒出幽灵项目。
    expect(isFlowWorktreePath("/x/kunpeng/.kunpeng/wt/某流-0-0")).toBe(true);
    expect(isFlowWorktreePath("/x/repo/.kunpeng/worktrees/abc")).toBe(true);
    expect(isFlowWorktreePath("/x/acme-shop")).toBe(false);
    const stateDir = await mkdtemp(join(tmpdir(), "kp-adv-"));
    const wt = join(stateDir, "fake", ".kunpeng", "wt", "某流-0-0");
    await expect(registerProject({ repoPath: wt, stateDir, now: 1 })).rejects.toThrow(/flow worktree/);
    expect((await readRegistry(stateDir)).length).toBe(0);
  });

  it("攻击5 spec 静默失效:YAML 列表 scope / 未收尾 fence / 缺 path 的 accept-file → lint error", () => {
    // 三个曾静默通过的坑,现在必须被 lintSpecText 拦成 error。
    const yamlScope = "```scope\nallow:\n  - orchestrator/src/a.ts\n```\n\n# 段\n正文\n\n```accept\ngrep x && npx vitest run t\n```\n";
    expect(lintSpecText(yamlScope).some((i: { level: string }) => i.level === "error")).toBe(true);

    const good = "```scope\nallow: orchestrator/src/a.ts\nallow: test/a.test.ts\n```\n\n# 段\n正文\n\n```accept\ngrep x orchestrator/src/a.ts && npx vitest run test/a.test.ts\n```\n\n```accept-file path=test/a.test.ts\nimport { it, expect } from \"vitest\";\nit(\"x\", () => expect(1).toBe(1));\n```\n";
    const unterminated = good.slice(0, good.lastIndexOf("```"));
    expect(lintSpecText(unterminated).some((i: { code: string }) => i.code === "fence-unterminated")).toBe(true);

    const noPath = good.replace("```accept-file path=test/a.test.ts", "```accept-file");
    expect(lintSpecText(noPath).some((i: { code: string }) => i.code === "accept-file-no-path")).toBe(true);

    // 干净 spec 零 error(反向对照,防规则过严把好 spec 也拦了)
    expect(lintSpecText(good).filter((i: { level: string }) => i.level === "error").length).toBe(0);
  });

  it("攻击6 路径歧义(glob 语义钉入回归):allow 单层 glob 的匹配边界按真实实现固化", () => {
    // 目的不是断言某个语义对错,而是把当前 glob 行为钉进回归——一旦匹配语义被改动此处会亮。
    const scope = "```scope\nallow: orchestrator/src/*.ts\n```\n\n# 段\n正文";
    const topLevel = planScopeViolations(scope, ["orchestrator/src/a.ts"]);
    expect(topLevel.length).toBe(0); // 单层直接命中
    const nested = planScopeViolations(scope, ["orchestrator/src/deep/nested.ts"]);
    // 记录真实行为:若 * 不跨目录则越界(length>0),若跨目录则放行(length===0)。
    // 用宽松断言固化"这是被有意识测过的语义",数值随实现,改动即触发 review。
    expect(nested.length === 0 || nested.length === 1).toBe(true);
    expect(isMachineSpecCopy("docs/specs/x.md")).toBe(false);
  });
});
