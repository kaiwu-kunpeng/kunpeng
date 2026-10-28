import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditAcceptanceTest } from "../src/loop/audit.js";

test("existence-only / no-op commands are judged WEAK (C3)", () => {
  for (const cmd of ["test -f hello.txt", "[ -f hello.txt ]", "ls hello.txt", "stat hello.txt", "true", ":", ""]) {
    expect(auditAcceptanceTest(cmd).strong, cmd).toBe(false);
  }
});

test("vitest commands fail closed when explicitly named test files are missing", () => {
  const root = mkdtempSync(join(tmpdir(), "kp-audit-"));
  try {
    mkdirSync(join(root, "orchestrator", "test"), { recursive: true });
    writeFileSync(join(root, "orchestrator", "test", "present.test.ts"), "import { test } from 'vitest';\n");

    expect(
      auditAcceptanceTest(
        "cd orchestrator && npx --no-install vitest run test/present.test.ts test/missing.test.ts",
        { cwd: root },
      ),
    ).toEqual({
      strong: false,
      reason: "vitest 命令点名的测试文件不存在: test/missing.test.ts",
    });
    expect(
      auditAcceptanceTest("cd orchestrator && npx --no-install vitest run test/present.test.ts", { cwd: root }).strong,
    ).toBe(true);
    expect(
      auditAcceptanceTest("cd orchestrator && npx --no-install vitest run test/locked.test.ts", {
        cwd: root,
        authorFilePaths: ["orchestrator/test/locked.test.ts"],
      }).strong,
    ).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("content/assertion-level commands are judged STRONG", () => {
  for (const cmd of [
    "cmp -s hello.txt <(printf 'ok')",
    'test "$(cat hello.txt)" = ok',
    "grep -q ok hello.txt",
    "npm test",
    'node -e "process.exit(0)"',
    "pytest -q",
  ]) {
    expect(auditAcceptanceTest(cmd).strong, cmd).toBe(true);
  }
});
