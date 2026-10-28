import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifySensitiveFiles } from "../../src/runtime/sensitive-paths.js";
import { AUTOPILOT_GUARD_KEYS } from "../../src/server/autopilot-guards.js";

describe("分级表与守门测试模块受保护（作者锁定）", () => {
  it("改 merge-tiers.ts / merge-guard-tests.ts 命中「守门器源码」", () => {
    for (const file of ["orchestrator/src/runtime/merge-tiers.ts", "src/runtime/merge-guard-tests.ts"]) {
      const { hits } = classifySensitiveFiles([file]);
      expect(hits.map((h) => h.label), file).toContain("守门器源码");
    }
    expect(classifySensitiveFiles(["orchestrator/test/runtime/merge-tiers.test.ts"]).hits).toEqual([]);
  });

  it("autopilot 闸构造器登记了 tier", () => {
    expect(AUTOPILOT_GUARD_KEYS).toContain("tier");
  });

  it("环境变量参考表补齐五个开关，且 KUNPENG_REQUIRE_SCOPE 一行写的是现状（默认开）", () => {
    const doc = readFileSync(new URL("../../../docs/runbooks/env-vars.md", import.meta.url), "utf8");
    for (const key of ["KUNPENG_GUARD_TESTS", "KUNPENG_MERGE_TIERS", "KUNPENG_RED_FIRST", "KUNPENG_STATE_CAS", "KUNPENG_BACKEND_DOWN_TTL_MS"]) {
      expect(doc, key).toContain(`| \`${key}\` |`);
    }
    const scopeRow = doc.split("\n").find((l) => l.startsWith("| `KUNPENG_REQUIRE_SCOPE` |")) ?? "";
    expect(scopeRow).toContain("=0");
    expect(scopeRow).not.toContain("值为 `1` 时");
    const tiersRow = doc.split("\n").find((l) => l.startsWith("| `KUNPENG_MERGE_TIERS` |")) ?? "";
    expect(tiersRow).toContain("enforce");
    expect(tiersRow).toContain("C5");
  });
});