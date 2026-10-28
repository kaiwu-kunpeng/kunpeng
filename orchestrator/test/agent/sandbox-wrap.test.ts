import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  buildSandboxProfile, collectWriteScopes, sandboxAvailable, wrapWithSandbox,
} from "../../src/agent/sandbox-wrap.js";

describe("sandboxAvailable", () => {
  test("darwin + sandbox-exec 存在 → true", () => {
    expect(sandboxAvailable({ platform: "darwin", hasSandboxExec: () => true })).toBe(true);
  });
  test("非 darwin → false", () => {
    expect(sandboxAvailable({ platform: "linux", hasSandboxExec: () => true })).toBe(false);
  });
  test("无 sandbox-exec → false", () => {
    expect(sandboxAvailable({ platform: "darwin", hasSandboxExec: () => false })).toBe(false);
  });
});

describe("collectWriteScopes", () => {
  test("worktree 与 tmp 都进结果，且为 realpath", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "sbw-")));
    const scopes = collectWriteScopes(root, [root]);
    expect(scopes).toContain(root);
    // 去重：worktree 与 tmp 传了同一个 root，只应出现一次
    expect(scopes.filter((s) => s === root)).toHaveLength(1);
  });

  test("node_modules 存在 → 追加 .vite/.vite-temp/.cache 三个缓存子目录", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "sbw-")));
    mkdirSync(join(root, "orchestrator", "node_modules"), { recursive: true });
    const scopes = collectWriteScopes(root, []);
    const nm = realpathSync(join(root, "orchestrator", "node_modules"));
    expect(scopes).toContain(join(nm, ".vite"));
    expect(scopes).toContain(join(nm, ".vite-temp"));
    expect(scopes).toContain(join(nm, ".cache"));
  });

  test("无 node_modules → 不追加缓存路径", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "sbw-")));
    const scopes = collectWriteScopes(root, []);
    expect(scopes.some((s) => s.includes(".vite"))).toBe(false);
  });

  test("空串条目被跳过", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "sbw-")));
    const scopes = collectWriteScopes(root, ["", root]);
    expect(scopes).not.toContain("");
  });
});

describe("buildSandboxProfile", () => {
  const profile = buildSandboxProfile(["/a/b", "/c/d"]);

  test("含 deny file-write* 基线", () => {
    expect(profile).toContain("(deny file-write*)");
  });
  test("每个 scope 一条 subpath", () => {
    expect(profile).toContain('(subpath "/a/b")');
    expect(profile).toContain('(subpath "/c/d")');
  });
  test("恒含 /dev", () => {
    expect(profile).toContain('(subpath "/dev")');
  });
  test("恒含 claude 临时根 regex", () => {
    expect(profile).toContain('(regex #"^/private/tmp/claude-[^/]+")');
  });
  test("路径中的引号被转义，不破坏 profile 语法", () => {
    const evil = buildSandboxProfile(['/a/"; (allow file-write*) ;"']);
    // 转义后原始的未转义 " 注入序列不应原样出现
    expect(evil).not.toContain('/a/"; (allow file-write*) ;"');
    expect(evil).toContain("\\\"");
  });
});

describe("wrapWithSandbox", () => {
  test("file 变成 sandbox-exec，-f profile 在前，原命令随后，原 args 顺序不变", () => {
    const { file, args } = wrapWithSandbox("claude", ["-p", "--output-format", "json"], "/tmp/p.sb");
    expect(file).toBe("/usr/bin/sandbox-exec");
    expect(args.slice(0, 2)).toEqual(["-f", "/tmp/p.sb"]);
    expect(args[2]).toBe("claude");
    expect(args.slice(3)).toEqual(["-p", "--output-format", "json"]);
  });
});

describe("接线到位", () => {
  test("cli-runner 在两处调用点用 applySandbox 包裹 file/args", () => {
    const src = readFileSync(new URL("../../src/agent/cli-runner.ts", import.meta.url), "utf8");
    expect(src).toContain("applySandbox");
    // 默认关：必须有 KUNPENG_SANDBOX 开关判断
    expect(src).toContain("KUNPENG_SANDBOX");
    // 包裹结果被真正传给 exec/streamExec（而非丢弃）
    expect(src).toMatch(/sb\.file/);
    expect(src).toMatch(/sb\.args/);
  });
});