import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import "../../src/cli.js";
import { dispatchCliCommand } from "../../src/cli-commands/registry.js";
import { extractCandidates, parseClaudeSession } from "../../src/knowledge/session-harvest.js";

const line = (obj: unknown): string => JSON.stringify(obj);

/** 一次工具报错 → 同名工具随后成功：只有报错是真错误时才算调试经验。 */
function session(errorText: string): string {
  return [
    line({ type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "Bash", input: { command: "first try" } }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", is_error: true, content: errorText }] } }),
    line({ type: "assistant", message: { content: [{ type: "tool_use", id: "b", name: "Bash", input: { command: "second try" } }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b", content: "ok" }] } }),
  ].join("\n");
}

describe("真跑发现的缺陷①：会话采集不把审批提示当调试经验（作者锁定）", () => {
  test.each([
    "This Bash command contains multiple operations. The following part requires approval: rm x",
    "Contains simple_expansion",
    "Contains command substitution",
    "Contains shell syntax (string) that cannot be statically analyzed",
    "This command requires approval",
  ])("审批类提示不产出候选：%s", (text) => {
    expect(extractCandidates(parseClaudeSession(session(text)))).toEqual([]);
  });

  test("真错误照常产出候选", () => {
    const out = extractCandidates(parseClaudeSession(session("Exit code 1\nError: Cannot find module 'foo'")));
    expect(out.map((c) => c.kind)).toEqual(["tool-recovery"]);
  });
});

describe("真跑发现的缺陷②：skill pack --out 生效（经 CLI 统一参数解析，作者锁定）", () => {
  test("--out 由 cli 解析进 context.outArg，技能包写到指定目录，不写仓库默认的 dist-skills", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-pack-out-"));
    const out = mkdtempSync(join(tmpdir(), "kp-pack-dest-"));
    try {
      mkdirSync(join(repo, "skills", "demo"), { recursive: true });
      writeFileSync(join(repo, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: 演示技能\n---\n\n先写失败的测试，再写实现。\n");
      execFileSync("git", ["init", "-q"], { cwd: repo });
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
      const handled = await dispatchCliCommand("skill", {
        repoRoot: repo, kunpengHome: repo, rest: ["pack"], argv: [], flags: new Set(), outArg: out,
      });
      expect(handled).toBe(true);
      expect(existsSync(join(out, "index.json"))).toBe(true);
      expect(existsSync(join(repo, "dist-skills"))).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });
});