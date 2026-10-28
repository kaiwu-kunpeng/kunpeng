import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureScopeGuard } from "../../src/agent/cli-runner.js";
import type { AgentRequest } from "../../src/agent/runner.js";

function req(cwd: string): AgentRequest {
  return { stage: "implement", system: "s", input: "i", tools: [], cwd, scopeAllow: ["src/**"] };
}

describe("审计修复K scope-guard 挂载 fail-closed", () => {
  it("正常挂载:注入 --settings 与 KP_SCOPE_ALLOW,settings 含 Bash + Write 两个 matcher", () => {
    const cwd = mkdtempSync(join(tmpdir(), "kp-fc-"));
    const out = configureScopeGuard(req(cwd), "claude", ["-p"], { A: "1" });
    const idx = out.args.indexOf("--settings");
    expect(idx).toBeGreaterThan(-1);
    const settingsPath = out.args[idx + 1];
    expect(existsSync(settingsPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(settingsPath, "utf8")) as { hooks: { PreToolUse: Array<{ matcher: string }> } };
    const matchers = cfg.hooks.PreToolUse.map((h) => h.matcher);
    expect(matchers).toContain("Bash");
    expect(matchers).toContain("Write|Edit|MultiEdit|NotebookEdit");
    expect(out.env?.KP_SCOPE_ALLOW).toBe("src/**");
  });

  it("hook 脚本缺失 → 抛 fail-closed,不再静默放行", () => {
    const cwd = mkdtempSync(join(tmpdir(), "kp-fc-"));
    const missing = join(cwd, "no-such-script.cjs");
    expect(() => configureScopeGuard(req(cwd), "claude", [], undefined, { scopeGuard: missing, bashShield: missing }))
      .toThrow(/fail-closed/);
  });

  it("写 hook 配置失败 → 抛 fail-closed(cwd 是文件,mkdir 必败)", () => {
    const base = mkdtempSync(join(tmpdir(), "kp-fc-"));
    const fileAsCwd = join(base, "not-a-dir");
    writeFileSync(fileAsCwd, "x", "utf8");
    expect(() => configureScopeGuard(req(fileAsCwd), "claude", [])).toThrow(/fail-closed/);
  });

  it("不需挂盾路径不受影响:codex 后端/无 scopeAllow 原样返回不抛", () => {
    const cwd = mkdtempSync(join(tmpdir(), "kp-fc-"));
    const r1 = configureScopeGuard(req(cwd), "codex", ["-p"], { A: "1" });
    expect(r1.args).toEqual(["-p"]);
    expect(r1.env).toEqual({ A: "1" });
    const noScope: AgentRequest = { stage: "implement", system: "s", input: "i", tools: [], cwd };
    const r2 = configureScopeGuard(noScope, "claude", ["-p"]);
    expect(r2.args).toEqual(["-p"]);
  });
});