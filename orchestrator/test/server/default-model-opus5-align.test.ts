import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatInvocation } from "../../src/server/chat-stream.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function modelArg(args: string[]): string | undefined {
  const i = args.indexOf("--model");
  return i >= 0 ? args[i + 1] : undefined;
}

describe("默认模型兜底统一到 opus-5", () => {
  it("空 model 兜底到 claude-opus-5", () => {
    expect(modelArg(chatInvocation("", [], false).args)).toBe("claude-opus-5");
  });

  it("非 claude- 前缀的 model 兜底到 claude-opus-5", () => {
    expect(modelArg(chatInvocation("gpt-x", [], false).args)).toBe("claude-opus-5");
  });

  it("合法 claude- model 原样透传，不被兜底覆盖", () => {
    expect(modelArg(chatInvocation("claude-sonnet-4-6", [], false).args)).toBe("claude-sonnet-4-6");
  });

  it("前端 part04 兜底不再是 4.8", () => {
    const part04 = readFileSync(join(srcDir, "server", "ui", "client-parts", "part04.ts"), "utf8");
    expect(part04).not.toContain("claude-opus-4-8");
    expect(part04).toContain("claude-opus-5");
  });

  it("part03 的下拉选项已下线 4.8（2026-10-08 起不再提供）", () => {
    const part03 = readFileSync(join(srcDir, "server", "ui", "client-parts", "part03.ts"), "utf8");
    expect(part03).not.toContain("claude-opus-4-8");
    expect(part03).toContain("claude-opus-5");
  });
});