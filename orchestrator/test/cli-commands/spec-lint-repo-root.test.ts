import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/cli-commands/spec-tools.js";
import { dispatchCliCommand, type CliContext } from "../../src/cli-commands/registry.js";

let repo: string;

/** 造一个目标仓：orchestrator/test/real.test.ts 真实存在。 */
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-speclint-"));
  mkdirSync(join(repo, "orchestrator", "test"), { recursive: true });
  writeFileSync(join(repo, "orchestrator", "test", "real.test.ts"), "//\n");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeSpec(named: string): string {
  const path = join(repo, "probe.md");
  writeFileSync(path, [
    "# probe spec",
    "",
    "**实现要求**",
    "- 无。",
    "",
    "```scope",
    "allow: orchestrator/src/probe.ts",
    "```",
    "",
    "```accept",
    "set -e",
    "cd orchestrator",
    `npx --no-install vitest run ${named}`,
    "```",
    "",
  ].join("\n"));
  return path;
}

/** 跑一次 spec-lint 命令，桩掉 process.exit，返回退出码与打印内容。 */
async function runSpecLint(specPath: string): Promise<{ code: number; out: string }> {
  let code = -1;
  const lines: string[] = [];
  vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error("__exit__");
  }) as never);
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { lines.push(args.join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { lines.push(args.join(" ")); });
  const context: CliContext = {
    repoRoot: repo,
    kunpengHome: repo,
    rest: [specPath],
    argv: [],
    flags: new Set<string>(),
  };
  await expect(dispatchCliCommand("spec-lint", context)).rejects.toThrow("__exit__");
  return { code, out: lines.join("\n") };
}

describe("spec-lint 命令必须按目标仓根解析路径，而不是按进程 cwd", () => {
  it("点名的既有测试文件在目标仓里存在 → 通过（cwd 不是目标仓也一样）", async () => {
    const { code, out } = await runSpecLint(writeSpec("test/real.test.ts"));
    expect(out).not.toContain("测试文件不存在");
    expect(code).toBe(0);
  });

  it("点名幽灵文件仍然被拦（证明上一条不是空转通过）", async () => {
    const { code, out } = await runSpecLint(writeSpec("test/ghost.test.ts"));
    expect(out).toContain("test/ghost.test.ts");
    expect(code).toBe(1);
  });
});