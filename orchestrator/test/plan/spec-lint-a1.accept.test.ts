import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptNonFinalLines, lintSpecText, scopeTestConsumers } from "../../src/plan/spec-lint.js";
import { parseScopeDeclaration } from "../../src/verify/scope-gate.js";

const FENCE = "```";

function spec(scopeLines: string[], accept: string): string {
  return [
    "# demo-flow: small change",
    "",
    "**目标**",
    "- 改 foo。",
    "",
    `${FENCE}scope`,
    ...scopeLines,
    FENCE,
    "",
    `${FENCE}accept`,
    accept,
    FENCE,
    "",
  ].join("\n");
}

describe("acceptNonFinalLines", () => {
  it("独立成行的非末尾命令被列出", () => {
    expect(acceptNonFinalLines("false\necho ok")).toEqual(["false"]);
  });

  it("续行、注释、空行不算", () => {
    const cmd = ["# 说明", "cd orchestrator && \\", "  test -f a.ts &&", "  npx vitest run a", ""].join("\n");
    expect(acceptNonFinalLines(cmd)).toEqual([]);
  });

  it("单行命令不报", () => {
    expect(acceptNonFinalLines("cd orchestrator && npx vitest run a")).toEqual([]);
  });

  it("管道续行不算独立行", () => {
    expect(acceptNonFinalLines("npx vitest run a |\n  tee out.log")).toEqual([]);
  });
});

describe("scopeTestConsumers", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kp-a1-"));
    mkdirSync(join(root, "orchestrator", "src", "x"), { recursive: true });
    mkdirSync(join(root, "orchestrator", "test", "x"), { recursive: true });
    writeFileSync(join(root, "orchestrator", "src", "x", "foo.ts"), "export const foo = 1;\n");
    writeFileSync(join(root, "orchestrator", "test", "x", "foo-consumer.test.ts"), 'import { foo } from "../../src/x/foo.js";\n');
    writeFileSync(join(root, "orchestrator", "test", "x", "unrelated.test.ts"), 'import { bar } from "../../src/x/foobar.js";\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("漏圈的既有测试被找出（不误中 foobar）", () => {
    const text = spec(["allow: orchestrator/src/x/foo.ts"], "cd orchestrator && npx vitest run foo");
    const scope = parseScopeDeclaration(text)!;
    expect(scopeTestConsumers(scope.allow, root, scope)).toEqual([
      { file: "orchestrator/src/x/foo.ts", tests: ["orchestrator/test/x/foo-consumer.test.ts"] },
    ]);
    const issues = lintSpecText(text, root).filter((i) => i.code === "scope-test-consumers");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe("warn");
    expect(issues[0]!.message).toContain("orchestrator/test/x/foo-consumer.test.ts");
  });

  it("消费方已在 allow 内 → 不报", () => {
    const text = spec(["allow: orchestrator/src/x/foo.ts", "allow: orchestrator/test/x/foo-consumer.test.ts"], "cd orchestrator && npx vitest run foo");
    expect(lintSpecText(text, root).some((i) => i.code === "scope-test-consumers")).toBe(false);
  });

  it("allow 用 glob → 不展开、不报", () => {
    const text = spec(["allow: orchestrator/src/x/**"], "cd orchestrator && npx vitest run foo");
    expect(lintSpecText(text, root).some((i) => i.code === "scope-test-consumers")).toBe(false);
  });

  it("验收块非末尾独立行 → warn accept-nonfinal-line", () => {
    const text = spec(["allow: orchestrator/test/x/**"], "false\ncd orchestrator && npx vitest run foo");
    const hit = lintSpecText(text, root).find((i) => i.code === "accept-nonfinal-line");
    expect(hit?.level).toBe("warn");
    expect(hit?.message).toContain("false");
  });
});