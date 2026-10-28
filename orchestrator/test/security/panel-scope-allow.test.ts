import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PANEL_SCOPE_ALLOW, panelDevCycleDeps } from "../../src/server/workspace-endpoints.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const guard = join(root, "scripts", "pretooluse-scope-guard.cjs");

function runGuard(cwd: string, filePath: string): number {
  try {
    execFileSync("node", [guard], {
      input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath }, cwd }),
      env: { ...process.env, KP_SCOPE_ALLOW: PANEL_SCOPE_ALLOW.join(",") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

describe("审计修复M 面板 worktree 级 scopeAllow", () => {
  it("panelDevCycleDeps 注入 scopeAllow=** 且透传 base/flowId/onEvent/modelOverride", () => {
    expect(PANEL_SCOPE_ALLOW).toEqual(["**"]);
    const onEvent = (): void => {};
    const deps = panelDevCycleDeps({ a: 1 }, "flow-1", onEvent, "opus");
    expect(deps.scopeAllow).toEqual(["**"]);
    expect(deps.a).toBe(1);
    expect(deps.flowId).toBe("flow-1");
    expect(deps.onEvent).toBe(onEvent);
    expect(deps.modelOverride).toBe("opus");
    const noModel = panelDevCycleDeps({ b: 2 }, "flow-2", onEvent);
    expect(Object.prototype.hasOwnProperty.call(noModel, "modelOverride")).toBe(false);
  });

  it("guard 真实语义:** 放行 worktree 内写,拦 worktree 外写", () => {
    const cwd = mkdtempSync(join(tmpdir(), "kp-panel-"));
    expect(runGuard(cwd, join(cwd, "src", "a.ts"))).toBe(0);
    expect(runGuard(cwd, "deep/nested/file.txt")).toBe(0);
    expect(runGuard(cwd, "../outside.txt")).toBe(2);
    expect(runGuard(cwd, "/etc/hosts")).toBe(2);
  });
});