import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const guard = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "pretooluse-scope-guard.cjs");

function runGuard(payload: unknown, allow: string): { code: number; stderr: string } {
  try {
    execFileSync("node", [guard], {
      input: JSON.stringify(payload),
      env: { ...process.env, KP_SCOPE_ALLOW: allow },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: Buffer };
    return { code: err.status ?? -1, stderr: String(err.stderr ?? "") };
  }
}

describe("pre-tool-use 越界写拦截(作者验收)", () => {
  it("范围内 Write 放行", () => {
    const r = runGuard({ tool_name: "Write", tool_input: { file_path: "/repo/src/a/x.ts" }, cwd: "/repo" }, "src/a/**");
    expect(r.code).toBe(0);
  });

  it("越界 Write 拦截 exit 2 且 stderr 说明原因", () => {
    const r = runGuard({ tool_name: "Write", tool_input: { file_path: "/repo/src/b/y.ts" }, cwd: "/repo" }, "src/a/**");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("越界写被拦截");
    expect(r.stderr).toContain("src/b/y.ts");
  });

  it("非写工具与 .kunpeng/ 路径放行", () => {
    expect(runGuard({ tool_name: "Read", tool_input: { file_path: "/repo/x" }, cwd: "/repo" }, "src/a/**").code).toBe(0);
    expect(runGuard({ tool_name: "Write", tool_input: { file_path: "/repo/.kunpeng/state.json" }, cwd: "/repo" }, "src/a/**").code).toBe(0);
  });

  it("未设 KP_SCOPE_ALLOW 或坏输入 fail-open", () => {
    expect(runGuard({ tool_name: "Write", tool_input: { file_path: "/repo/any.ts" }, cwd: "/repo" }, "").code).toBe(0);
    try {
      execFileSync("node", [guard], { input: "not-json", env: { ...process.env, KP_SCOPE_ALLOW: "src/**" }, stdio: ["pipe", "pipe", "pipe"] });
      expect(true).toBe(true);
    } catch {
      expect.unreachable("坏输入必须 fail-open");
    }
  });

  it("cwd 外路径(..)按越界拦截", () => {
    const r = runGuard({ tool_name: "Edit", tool_input: { file_path: "/outside/z.ts" }, cwd: "/repo" }, "**");
    expect(r.code).toBe(2);
  });
});