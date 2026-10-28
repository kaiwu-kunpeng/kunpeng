import { expect, test } from "vitest";
import { runVerification, newFailures } from "../src/verify/gate.js";

test("passing command yields passed=true with output", async () => {
  const r = await runVerification({ cwd: process.cwd(), cmd: "node -e \"process.exit(0)\"" });
  expect(r.passed).toBe(true);
  expect(typeof r.output).toBe("string");
});

test("failing command yields passed=false and captures stderr", async () => {
  const r = await runVerification({ cwd: process.cwd(), cmd: "node -e \"console.error('boom');process.exit(1)\"" });
  expect(r.passed).toBe(false);
  expect(r.output).toContain("boom");
});

test("newFailures: only NEW error-like lines vs baseline (differential)", () => {
  const base = "> typecheck\nfile.ts(1,1): error TS1: old\n";
  const after = "> typecheck\nfile.ts(1,1): error TS1: old\nnew.ts(2,2): error TS2: new\n";
  expect(newFailures(base, after)).toEqual(["new.ts(2,2): error TS2: new"]);
});

test("newFailures: empty when baseline-red but unchanged (pre-existing failures don't count)", () => {
  const s = "> typecheck\nfile.ts(1,1): error TS1: preexisting\n";
  expect(newFailures(s, s)).toEqual([]);
});

test("newFailures: ignores new non-error lines (progress/info)", () => {
  expect(newFailures("a", "a\nCompiled successfully\njust a line")).toEqual([]);
});
