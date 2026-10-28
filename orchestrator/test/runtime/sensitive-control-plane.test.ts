import { describe, expect, it } from "vitest";
import { classifySensitiveFiles, SENSITIVE_PATH_RULES } from "../../src/runtime/sensitive-paths.js";

describe("控制面、技能、宪法与守门器源码都在敏感清单里（作者锁定）", () => {
  it("清单至少 13 条", () => {
    expect(SENSITIVE_PATH_RULES.length).toBeGreaterThanOrEqual(13);
  });

  it.each([
    [".kunpeng/gates.json", "闸门控制面"],
    [".kunpeng/hooks.json", "闸门控制面"],
    [".kunpeng/checks.json", "闸门控制面"],
    [".kunpeng/public-surface.json", "闸门控制面"],
    ["orchestrator/.kunpeng/hooks.json", "闸门控制面"],
    [".kunpeng/ops-gates/opsgate-abc.json", "运营门文件"],
    ["skills/geo-answer-optimization/SKILL.md", "技能资产"],
    ["skills/one-file-skill.md", "技能资产"],
    [".kunpeng/skills/lessons.jsonl", "技能资产"],
    ["constitution/core.md", "宪法与角色卡"],
    ["roster/dev.role.md", "宪法与角色卡"],
    ["orchestrator/src/runtime/sensitive-paths.ts", "守门器源码"],
    ["orchestrator/src/runtime/merge-gate.ts", "守门器源码"],
    ["orchestrator/src/runtime/merge-review.ts", "守门器源码"],
    ["orchestrator/src/runtime/gate-mode.ts", "守门器源码"],
    ["orchestrator/src/runtime/hooks.ts", "守门器源码"],
    ["orchestrator/src/loop/autopilot.ts", "守门器源码"],
    ["orchestrator/src/agent/sandbox-signal.ts", "守门器源码"],
    ["orchestrator/src/agent/sandbox-wrap.ts", "守门器源码"],
    ["orchestrator/src/verify/scope-gate.ts", "守门器源码"],
    ["orchestrator/src/verify/scope-main-gate.ts", "守门器源码"],
    ["src/server/authz.ts", "守门器源码"],
  ])("命中 %s → %s", (file, label) => {
    const out = classifySensitiveFiles([file]);
    expect(out.sensitive).toBe(true);
    expect(out.hits.map((h) => h.label)).toContain(label);
  });

  it.each([
    "orchestrator/src/runtime/merge-review.test.ts",
    "orchestrator/test/runtime/gate-mode.test.ts",
    "orchestrator/src/skills/registry.ts",
    "orchestrator/src/loop/learnings.ts",
    "orchestrator/src/metrics/gate-ledger.ts",
    "docs/skills-guide.md",
    "docs/constitution-notes.md",
    ".kunpeng/state/flow.json",
  ])("不命中 %s", (file) => {
    expect(classifySensitiveFiles([file])).toEqual({ sensitive: false, hits: [] });
  });
});