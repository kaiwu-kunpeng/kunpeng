import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGuardian, type Scanner } from "../src/loop/guardian.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-guard-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "foo.ts"), "export const x = 1; // TODO: fix this\nconst y = 2;\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const todoScanner: Scanner = {
  name: "todo", severity: "info",
  cmd: "grep -rn --include='*.ts' -E 'TODO|FIXME' src",
};

test("guardian finds a TODO with file and line (deterministic, no LLM)", async () => {
  const findings = await runGuardian(dir, [todoScanner]);
  expect(findings.length).toBeGreaterThanOrEqual(1);
  const f = findings[0];
  expect(f.scanner).toBe("todo");
  expect(f.file).toContain("foo.ts");
  expect(typeof f.line).toBe("number");
  expect(f.message).toContain("TODO");
});

test("scanner with no matches (grep exit 1) returns [] and does not throw", async () => {
  const none: Scanner = { name: "none", severity: "warn", cmd: "grep -rn 'ZZZ_NOPE' src" };
  const findings = await runGuardian(dir, [none]);
  expect(findings).toEqual([]);
});

test("scanner that crashes (exit >1, no output) surfaces an error finding, not silent []", async () => {
  const broken: Scanner = { name: "broken", severity: "warn", cmd: "grep -rn 'x' no_such_dir_zzz" };
  const findings = await runGuardian(dir, [broken]);
  expect(findings).toHaveLength(1);
  expect(findings[0].severity).toBe("error");
  expect(findings[0].message).toMatch(/执行失败|exit/);
});

test("scanner with stdout but exit>1 (tsc-style) parses findings, not collapsed to one crash", async () => {
  // 模拟 tsc：错误打到 stdout、退出码 2。应逐行解析为 findings。
  const tscLike: Scanner = { name: "typecheck", severity: "error", cmd: "printf 'a.ts:10:type error\\nb.ts:20:another\\n'; exit 2" };
  const findings = await runGuardian(dir, [tscLike]);
  expect(findings).toHaveLength(2);
  expect(findings[0].file).toBe("a.ts");
  expect(findings[0].line).toBe(10);
});
