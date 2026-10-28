import { describe, expect, it } from "vitest";
import { classifySensitiveFiles } from "../../src/runtime/sensitive-paths.js";

const NEWLY_GUARDED = [
  "src/server/autopilot-guards.ts",
  "src/server/workspace-route.ts",
  "src/server/worker/host-permissions.ts",
  "src/verify/gate.ts",
  "src/verify/red-first.ts",
  "src/loop/scope-audit.ts",
  "src/policy/action-levels.ts",
];

describe("组装门禁的文件与权限上限执行点进敏感清单（作者锁定）", () => {
  it.each(NEWLY_GUARDED.flatMap((file) => [file, `orchestrator/${file}`]))("命中 %s → 守门器源码", (file) => {
    const out = classifySensitiveFiles([file]);
    expect(out.sensitive).toBe(true);
    expect(out.hits.map((hit) => hit.label)).toContain("守门器源码");
  });

  it.each([
    "orchestrator/src/verify/gate.test.ts",
    "orchestrator/src/verify/red-first.test.ts",
    "orchestrator/src/server/workspace-route.test.ts",
    "orchestrator/src/server/chat-usage.ts",
    "orchestrator/src/loop/learnings.ts",
    "orchestrator/src/verify/gate-log.ts",
    "orchestrator/src/policy/action-levels-table.md",
  ])("不命中 %s", (file) => {
    expect(classifySensitiveFiles([file])).toEqual({ sensitive: false, hits: [] });
  });

  it("一条流同时改 autopilot-guards 与普通文件 → 整体敏感，只报敏感那一个", () => {
    const out = classifySensitiveFiles([
      "orchestrator/src/server/chat-usage.ts",
      "orchestrator/src/server/autopilot-guards.ts",
    ]);
    expect(out.sensitive).toBe(true);
    expect(out.hits).toEqual([{ file: "orchestrator/src/server/autopilot-guards.ts", label: "守门器源码" }]);
  });
});