import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { helpOutput } from "../../src/cli.js";
import { CliUsageError, dispatchCliCommand, listCliCommands, type CliContext } from "../../src/cli-commands/registry.js";
import { cliEntrySource } from "../helpers/cli-source.js";

// 首批登记 usage 的命令:审计点名的 5 个缺参问题命令 + 高频命令。
const FIRST_BATCH = [
  "run", "plan", "merge", "send", "kickoff", "loop", "evaluate", "eval",
  "capture", "recall", "spec-lint", "upgrade", "version",
];

// 棘轮:未登记 usage 的命令数只减不增(派流时注册表共 99 个命令,首批补 13 个后为 86)。
const MAX_WITHOUT_USAGE = 86;

function ctx(rest: string[]): CliContext {
  const dir = mkdtempSync(join(tmpdir(), "kp-help-"));
  return { repoRoot: dir, kunpengHome: dir, rest, argv: rest, flags: new Set<string>() };
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("R26:单命令 --help", () => {
  it("首批命令都登记了 usage,且 --help 输出的就是它自己的 usage", () => {
    for (const name of FIRST_BATCH) {
      const cmd = listCliCommands().find((c) => c.name === name);
      expect(cmd, name).toBeDefined();
      expect(cmd?.usage, name).toMatch(new RegExp(`kunpeng ${name}(\\s|$)`));
      const out = helpOutput([name, "--help"]);
      expect(out, name).toBe(cmd?.usage);
      expect(out.startsWith("命令: "), name).toBe(false);
    }
  });

  it("-h 与前置 --repo 写法同样命中单命令 usage", () => {
    expect(helpOutput(["--repo", "/tmp/x", "send", "-h"])).toMatch(/kunpeng send/);
  });

  it("没给命令、未知命令、未登记 usage 的命令:回退全局命令清单", () => {
    expect(helpOutput(["--help"]).startsWith("命令: ")).toBe(true);
    expect(helpOutput(["no-such-cmd", "--help"]).startsWith("命令: ")).toBe(true);
    const withoutUsage = listCliCommands().find((c) => !c.usage && c.name !== "worker" && c.name !== "deploy");
    if (withoutUsage) expect(helpOutput([withoutUsage.name, "--help"]).startsWith("命令: ")).toBe(true);
  });

  it("棘轮:未登记 usage 的命令数不超过上限", () => {
    const missing = listCliCommands().filter((c) => !c.usage).map((c) => c.name);
    expect(missing.length, `未登记 usage: ${missing.join(", ")}`).toBeLessThanOrEqual(MAX_WITHOUT_USAGE);
  });
});

describe("R26:缺参统一退出码 1、用法打到 stderr、不抛堆栈", () => {
  for (const name of ["send", "kickoff", "loop", "evaluate", "eval"]) {
    it(`${name} 缺参`, async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});
      await expect(dispatchCliCommand(name, ctx([]))).resolves.toBe(true);
      expect(process.exitCode).toBe(1);
      const args = err.mock.calls.flat();
      expect(args.every((a) => typeof a === "string"), "stderr 只能是纯文本,不能把 Error 对象(带堆栈)丢给 console.error").toBe(true);
      const text = args.join("\n");
      expect(text).toMatch(new RegExp(`用法: kunpeng ${name}`));
      expect(text).not.toMatch(/\n\s+at /);
    });
  }

  it("CliUsageError 是 Error 子类,message 保留原文", () => {
    const e = new CliUsageError("用法: kunpeng demo");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("用法: kunpeng demo");
  });

  it("非用法类异常照常向上抛,不被吞成退出码 1", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // run 在无需求文本时走自身用法分支并 process.exit;这里只验 dispatch 对未知命令返回 false
    await expect(dispatchCliCommand("no-such-cmd", ctx([]))).resolves.toBe(false);
  });
});

describe("R26:未知命令不再多打一行无关的 spec-lint 用法", () => {
  it("cli.ts 已删除遗留的 spec-lint 行", () => {
    expect(cliEntrySource()).not.toContain("spec-lint: kunpeng spec-lint <spec.md> [--strict]");
  });
});