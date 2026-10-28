import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { sandboxDecision } from "../../src/agent/sandbox-signal.js";

const ok = { envValue: "1", cwd: "/wt", scopeAllowCount: 1, available: true };

describe("F48 sandboxDecision 对 codex 跳过", () => {
  test("codex + 全满足 → 不启用，理由 codex-incompatible", () => {
    const d = sandboxDecision({ ...ok, backend: "codex" });
    expect(d.engaged).toBe(false);
    expect(d.reason).toBe("codex-incompatible");
  });

  test("claude + 全满足 → 照常启用", () => {
    expect(sandboxDecision({ ...ok, backend: "claude" }).engaged).toBe(true);
  });

  test("backend undefined + 全满足 → 启用（向后兼容）", () => {
    expect(sandboxDecision(ok).engaged).toBe(true);
  });

  test("env 非 1 时即便 codex，理由仍是 disabled-by-default（env 优先）", () => {
    const d = sandboxDecision({ ...ok, envValue: "0", backend: "codex" });
    expect(d.engaged).toBe(false);
    expect(d.reason).toBe("disabled-by-default");
  });

  test("env undefined + codex → 仍是 disabled-by-default", () => {
    expect(sandboxDecision({ ...ok, envValue: undefined, backend: "codex" }).reason).toBe("disabled-by-default");
  });
});

describe("F48 接线与注释", () => {
  const src = readFileSync(new URL("../../src/agent/cli-runner.ts", import.meta.url), "utf8");

  test("applySandbox 把 backend 传给 sandboxDecision", () => {
    expect(src).toMatch(/sandboxDecision\(\{[\s\S]*?backend[\s\S]*?\}\)/);
  });

  test("两个调用点都把 backend 传给 applySandbox", () => {
    const calls = src.match(/applySandbox\(file, guarded\.args, cwd, req, backend\)/g) ?? [];
    expect(calls.length).toBe(2);
  });

  test("陈旧注释已修正：不再宣称默认生效", () => {
    expect(src).not.toContain("默认生效");
    expect(src).not.toContain("KUNPENG_SANDBOX=0 显式关闭");
  });

  test("注释点明 codex 跳过", () => {
    const idx = src.indexOf("private applySandbox");
    const around = src.slice(Math.max(0, idx - 400), idx);
    expect(around).toContain("codex");
  });
});