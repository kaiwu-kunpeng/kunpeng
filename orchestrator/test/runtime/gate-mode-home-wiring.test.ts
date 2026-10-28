import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), "utf8");

describe("闸门模式配置与控制面审计接线（作者锁定）", () => {
  it("gate-mode 不再从 repoRoot 读 gates.json；状态目录从 env 解析", () => {
    const text = src("runtime/gate-mode.ts");
    expect(text).toContain("kunpengStateDir(env)");
    expect(text).toContain("export function legacyRepoGatesConfigPath");
    expect(text).toContain("export function warnLegacyRepoGatesConfig");
    expect(text).not.toMatch(/return join\(repoRoot, "\.kunpeng", "gates\.json"\)/);
  });
  it("dispatch-overlap 走状态目录", () => {
    expect(src("loop/dispatch-overlap.ts")).toContain("kunpengStateDir(env)");
  });
  it("合并门与 autopilot 都记控制面变更；CLI 与路由已注册", () => {
    expect(src("runtime/merge-gate.ts")).toContain("recordControlPlaneChanges(repoRoot)");
    expect(src("cli-commands/loop-core.ts")).toContain("recordControlPlaneChanges(rp)");
    expect(src("cli-commands/reports.ts")).toContain('name: "control-plane-audit"');
    expect(src("cli.ts")).toContain("control-plane-audit");
    expect(src("server/http.ts")).toContain('import "./routes/control-plane-audit.js"');
    expect(src("server/routes/control-plane-audit.ts")).toContain('path: "/api/control-plane-audit"');
  });
});