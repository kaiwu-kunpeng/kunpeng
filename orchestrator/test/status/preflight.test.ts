import { describe, it, expect } from "vitest";
import { collectPreflight, preflightAllOk } from "../../src/status/preflight.js";

const okDeps = {
  home: "/h",
  readFile: async (p: string) => {
    if (p === "/h/.claude.json") return JSON.stringify({ oauthAccount: { emailAddress: "a@b.c" } });
    throw new Error("no file: " + p);
  },
  exists: (p: string) => p === "/h/.codex/auth.json" || p === "/opt/homebrew/bin/tmux",
};

describe("collectPreflight 确定性探针", () => {
  it("全绿：三项 ok 且 preflightAllOk=true", async () => {
    const items = await collectPreflight(okDeps);
    expect(items.map((i) => i.key).sort()).toEqual(["claude-auth", "codex-auth", "tmux"]);
    expect(items.every((i) => i.ok)).toBe(true);
    expect(preflightAllOk(items)).toBe(true);
  });

  it("claude 登出（oauthAccount 缺失）→ claude-auth 不 ok 且带 hint", async () => {
    const items = await collectPreflight({
      ...okDeps,
      readFile: async () => JSON.stringify({}),
    });
    const c = items.find((i) => i.key === "claude-auth");
    expect(c?.ok).toBe(false);
    expect(c?.hint).toContain("login");
    expect(preflightAllOk(items)).toBe(false);
  });

  it("文件缺失/坏 JSON 一律 false 不抛", async () => {
    const items = await collectPreflight({
      home: "/h",
      readFile: async () => "not-json{{",
      exists: () => false,
    });
    expect(items.every((i) => !i.ok)).toBe(true);
  });
});