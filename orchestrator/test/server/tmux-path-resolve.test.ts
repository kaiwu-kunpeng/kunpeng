import { describe, it, expect } from "vitest";
import { findTmuxBin } from "../../src/server/pty-tmux.js";

describe("B3:tmux 解析 PATH 优先、候选表兜底", () => {
  it("PATH 目录里的 tmux 优先命中", () => {
    const exists = (p: string) => p === "/custom/bin/tmux";
    expect(findTmuxBin(exists, "/custom/bin:/usr/bin")).toBe("/custom/bin/tmux");
  });

  it("PATH 无命中回退既有候选表", () => {
    const exists = (p: string) => p === "/usr/bin/tmux";
    expect(findTmuxBin(exists, "/custom/bin")).toBe("/usr/bin/tmux");
  });

  it("不传 pathEnv 与全无命中的行为", () => {
    expect(findTmuxBin((p) => p === "/opt/homebrew/bin/tmux")).toBe("/opt/homebrew/bin/tmux");
    expect(findTmuxBin(() => false, "/a:/b")).toBeNull();
  });
});