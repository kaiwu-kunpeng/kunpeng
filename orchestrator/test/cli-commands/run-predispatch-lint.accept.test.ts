import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { preDispatchLint } from "../../src/cli-commands/devcycle.js";

const F = "`".repeat(3);
const repo = mkdtempSync(join(tmpdir(), "kp-run-lint-"));
const TEST_BODY = 'import { expect, it } from "vitest";\nit("a", () => { expect(1).toBe(1); });';

const withScope = [
  "# 有 scope 的 spec", "正文", "",
  `${F}scope`, "allow: orchestrator/src/x.ts", "allow: orchestrator/test/x.accept.test.ts", F, "",
  `${F}accept-file path=orchestrator/test/x.accept.test.ts`, TEST_BODY, F, "",
  `${F}accept`, "cd orchestrator && env -u KUNPENG_BACKEND npx --no-install vitest run test/x.accept.test.ts", F, "",
].join("\n");

describe("run 派 spec 文件前过 spec-lint（作者锁定）", () => {
  test("缺 scope 块 → blocked，报告点名 scope-missing", () => {
    const noScope = withScope.replace(/`{3}scope[\s\S]*?`{3}\n/, "");
    const out = preDispatchLint(noScope, repo, { acceptArgGiven: false });
    expect(out.blocked).toBe(true);
    expect(out.report).toContain("scope-missing");
  });

  test("合格 spec → 不 blocked", () => {
    expect(preDispatchLint(withScope, repo, { acceptArgGiven: false }).blocked).toBe(false);
  });

  test("spec 没写 accept 块：命令行给了 --accept 就不追究 accept-missing，没给则 blocked", () => {
    const noAccept = withScope.replace(/`{3}accept\n[\s\S]*?`{3}\n/, "");
    expect(preDispatchLint(noAccept, repo, { acceptArgGiven: true }).report).not.toContain("accept-missing");
    expect(preDispatchLint(noAccept, repo, { acceptArgGiven: true }).blocked).toBe(false);
    const bare = preDispatchLint(noAccept, repo, { acceptArgGiven: false });
    expect(bare.blocked).toBe(true);
    expect(bare.report).toContain("accept-missing");
  });
});

describe("run 命令接线（作者锁定，源码形状）", () => {
  const src = readFileSync(new URL("../../src/cli-commands/devcycle.ts", import.meta.url), "utf8");
  const runStart = src.indexOf('name: "run"');
  const runBody = src.slice(runStart, src.indexOf("registerCliCommand(", runStart + 10));

  test("只对 spec 文件做闸：在 locateSpecInput 之后、kind 为 file 时调用 preDispatchLint", () => {
    const locateAt = runBody.indexOf("locateSpecInput(");
    const lintAt = runBody.indexOf("preDispatchLint(");
    expect(locateAt).toBeGreaterThan(-1);
    expect(lintAt).toBeGreaterThan(locateAt);
    expect(runBody).toMatch(/kind === "file"/);
  });

  test("blocked 时 exit(2)，并把 --accept 是否给出传进去", () => {
    expect(runBody).toMatch(/\.blocked/);
    expect(runBody).toMatch(/process\.exit\(2\)/);
    expect(runBody).toContain("context.acceptArg");
  });
});