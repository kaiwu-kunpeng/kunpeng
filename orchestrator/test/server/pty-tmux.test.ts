import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tmuxSessionName, tmuxNewSessionArgs, tmuxHasSessionArgs, tmuxKillSessionArgs,
  findTmuxBin, resolveReviveDecision,
} from "../../src/server/pty-tmux.js";
import { readPtyRegistry, upsertPtyEntry, removePtyEntry } from "../../src/server/pty-registry.js";

describe("tmuxSessionName", () => {
  it("加 kpt- 前缀并保留安全字符", () => {
    expect(tmuxSessionName("pty-123-4")).toBe("kpt-pty-123-4");
  });
  it("危险字符逐个替换为下划线", () => {
    expect(tmuxSessionName("a.b:c d")).toBe("kpt-a_b_c_d");
  });
});

describe("tmux 参数拼装", () => {
  it("new-session 带 -u -A -D -s -c", () => {
    expect(tmuxNewSessionArgs({ sessionName: "kpt-x", cwd: "/tmp" }))
      .toEqual(["-u", "new-session", "-A", "-D", "-s", "kpt-x", "-c", "/tmp", ";", "set-option", "status", "off"]);
  });
  it("指定 shell 时追加为启动命令", () => {
    expect(tmuxNewSessionArgs({ sessionName: "kpt-x", cwd: "/tmp", shell: "/bin/zsh" }).slice(-5)).toEqual(["/bin/zsh", ";", "set-option", "status", "off"]);
  });
  it("has/kill 用 = 精确匹配目标", () => {
    expect(tmuxHasSessionArgs("kpt-x")).toEqual(["has-session", "-t", "=kpt-x"]);
    expect(tmuxKillSessionArgs("kpt-x")).toEqual(["kill-session", "-t", "=kpt-x"]);
  });
});

describe("findTmuxBin", () => {
  it("按顺序探测并返回第一个存在的", () => {
    expect(findTmuxBin((p) => p === "/usr/local/bin/tmux")).toBe("/usr/local/bin/tmux");
  });
  it("都不存在返回 null", () => {
    expect(findTmuxBin(() => false)).toBeNull();
  });
});

describe("resolveReviveDecision", () => {
  const entry = { workspaceId: "ws1", cwd: "/tmp" };
  it("池里活着 → reuse", () => {
    expect(resolveReviveDecision({ poolHasAlive: true, registryEntry: entry, tmuxHasSession: true, workspaceId: "ws1" })).toBe("reuse");
  });
  it("池里没有但注册表+tmux 都在且 workspace 匹配 → revive", () => {
    expect(resolveReviveDecision({ poolHasAlive: false, registryEntry: entry, tmuxHasSession: true, workspaceId: "ws1" })).toBe("revive");
  });
  it("workspace 不匹配 / tmux 会话不存在 / 无注册条目 → create", () => {
    expect(resolveReviveDecision({ poolHasAlive: false, registryEntry: entry, tmuxHasSession: true, workspaceId: "ws2" })).toBe("create");
    expect(resolveReviveDecision({ poolHasAlive: false, registryEntry: entry, tmuxHasSession: false, workspaceId: "ws1" })).toBe("create");
    expect(resolveReviveDecision({ poolHasAlive: false, tmuxHasSession: true, workspaceId: "ws1" })).toBe("create");
  });
});

describe("pty-registry", () => {
  it("增删读闭环,缺文件返回空表", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kpt-ptyreg-"));
    const file = join(dir, "pty-registry.json");
    try {
      expect(await readPtyRegistry(file)).toEqual({});
      await upsertPtyEntry(file, { id: "s1", workspaceId: "ws1", cwd: "/tmp", createdAt: 1 });
      await upsertPtyEntry(file, { id: "s2", workspaceId: "ws1", cwd: "/tmp", createdAt: 2 });
      await removePtyEntry(file, "s1");
      const reg = await readPtyRegistry(file);
      expect(Object.keys(reg)).toEqual(["s2"]);
      expect(reg.s2.createdAt).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("JSON 损坏返回空表不抛", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kpt-ptyreg-"));
    const file = join(dir, "pty-registry.json");
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(file, "{oops");
      expect(await readPtyRegistry(file)).toEqual({});
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
