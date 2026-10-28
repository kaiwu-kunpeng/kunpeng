import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("已替代孤儿模块清退", () => {
  it("三个死模块与其测试已删除", () => {
    expect(existsSync(join(src, "agent", "mcp-config.ts"))).toBe(false);
    expect(existsSync(join(src, "switchboard", "post.ts"))).toBe(false);
    expect(existsSync(join(src, "server", "ui", "views", "flow-diff-card.ts"))).toBe(false);
  });
  it("正身仍在", () => {
    expect(existsSync(join(src, "agent", "backend-adapter.ts"))).toBe(true);
    expect(existsSync(join(src, "switchboard", "signal.ts"))).toBe(true);
    expect(existsSync(join(src, "server", "ui", "client-parts", "part06.ts"))).toBe(true);
  });
});