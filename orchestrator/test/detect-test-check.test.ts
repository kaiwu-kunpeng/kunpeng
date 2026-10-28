import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectChecks } from "../src/project/detect.js";
import { assembleChecks } from "../src/sdk/context.js";

describe("回归门：项目测试套件进 checks", () => {
  it("detectChecks 探测 vitest test 脚本 -> npm test 且排除 flaky e2e/integration", async () => {
    const d = mkdtempSync(join(tmpdir(), "kp-detect-test-"));
    writeFileSync(join(d, "package.json"), JSON.stringify({ scripts: { test: "vitest run", typecheck: "tsc --noEmit" } }));
    const checks = await detectChecks(d);
    // vitest 项目故意在回归检查命令里排除 flaky 的 integration/e2e(护栏 ede9292),
    // 防差分门被带时间戳的集成/e2e 逐行差击穿。这里断言"含 npm test 且带 e2e 排除",不能改回裸 npm test。
    expect(checks.test).toContain("npm test");
    expect(checks.test).toContain("--exclude");
    expect(checks.test).toContain("e2e.test.ts");
  });
  it("assembleChecks 把 test 纳入回归检查（typecheck 在前、test 在后）", () => {
    expect(assembleChecks({ typecheck: "tc", test: "npm test" })).toEqual(["tc", "npm test"]);
  });
  it("assembleChecks 只有 typecheck 时不崩、且不含空值", () => {
    expect(assembleChecks({ typecheck: "tc" })).toEqual(["tc"]);
  });
});