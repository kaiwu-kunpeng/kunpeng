import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("agent 子进程与沙箱写域用每流 TMPDIR（作者锁定）", () => {
  it("cli-runner：env 与 seatbelt 写域都取 ensureFlowTmpDir(cwd)，不再用进程 TMPDIR", () => {
    const src = read("../../src/agent/cli-runner.ts");
    expect((src.match(/ensureFlowTmpDir\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).not.toContain('process.env.TMPDIR ?? "/tmp"');
  });

  it("verify/gate 接受 env；dev-cycle 给验收命令注入 TMPDIR；workspace 不再软链 dist", () => {
    expect(read("../../src/verify/gate.ts")).toContain("input.env");
    const dc = read("../../src/loop/dev-cycle.ts");
    expect(dc).toContain("ensureFlowTmpDir(");
    expect(dc).toContain("TMPDIR");
    const ws = read("../../src/git/workspace.ts");
    expect(ws).toContain("removeFlowTmpDir(");
    expect(ws).not.toContain('["node_modules", "dist"]');
  });
});