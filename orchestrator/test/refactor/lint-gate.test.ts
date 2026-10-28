import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("审计门禁", () => {
  it("lock.ts 的 finally 块内不再 throw(不许再吞掉原始异常)", () => {
    const src = readFileSync(new URL("../../src/taskboard/lock.ts", import.meta.url), "utf8");
    const idx = src.lastIndexOf("} finally {");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx)).not.toContain("throw ");
  });

  it("package.json 暴露 verify 脚本(lint+typecheck+test 一把过)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.verify).toContain("lint");
    expect(pkg.scripts.verify).toContain("typecheck");
  });

  it("确认已删的死符号不再出现在源码里", () => {
    const gone: [string, string][] = [
      ["../../src/metrics/time-saved.ts", "classifyFlowKind"],
      ["../../src/server/profile-middleware.ts", "guardProjectId"],
      ["../../src/server/localfs/chat-wiring.ts", "matchesLocalFsAuthorization"],
    ];
    for (const [rel, name] of gone) {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      expect(src, `${rel} 仍含 ${name}`).not.toContain(name);
    }
  });
});