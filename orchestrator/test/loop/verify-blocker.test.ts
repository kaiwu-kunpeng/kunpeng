import { expect, test } from "vitest";
import { formatVerifyBlocker } from "../../src/loop/verify-blocker.js";

test("通过 → 空 blocker", () => {
  expect(formatVerifyBlocker({ passed: true, output: "whatever", exitCode: 0 })).toBe("");
});

test("失败有输出 → 返回 trim 后的真实输出", () => {
  const b = formatVerifyBlocker({ passed: false, output: "  AssertionError: expected 1 to be 2  ", exitCode: 1 });
  expect(b).toBe("AssertionError: expected 1 to be 2");
});

test("失败但输出为空 → 给出退出码+静默失败提示(永不为空)", () => {
  const b = formatVerifyBlocker({ passed: false, output: "   \n  ", exitCode: 1 });
  expect(b).not.toBe("");
  expect(b).toContain("退出码 1");
  expect(b).toContain("无输出");
});

test("超长输出 → head+tail 截断,保留首尾,带截断标记", () => {
  const head = "HEAD_" + "a".repeat(1200);
  const tail = "b".repeat(1200) + "_TAIL";
  const b = formatVerifyBlocker({ passed: false, output: head + tail, exitCode: 2 }, 2000);
  expect(b).toContain("HEAD_");
  expect(b).toContain("_TAIL");
  expect(b).toContain("中段截断");
  expect(b.length).toBeLessThanOrEqual(2000 + 40);
});