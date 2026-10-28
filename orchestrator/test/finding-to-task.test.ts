import { test, expect } from "vitest";
import { acceptanceCmdForSource } from "../src/feedback/finding-to-task.js";

const detected = { lint: "npm run lint", typecheck: "tsc --noEmit", build: "npm run build" };

test("guardian:lint → 该仓 lint 命令", () => {
  expect(acceptanceCmdForSource("guardian:lint", detected)).toBe("npm run lint");
});
test("guardian:typecheck → 该仓 typecheck 命令", () => {
  expect(acceptanceCmdForSource("guardian:typecheck", detected)).toBe("tsc --noEmit");
});
test("guardian:build → 该仓 build 命令", () => {
  expect(acceptanceCmdForSource("guardian:build", detected)).toBe("npm run build");
});
test("未知扫描器 / 非 guardian 源 / 探不到命令 → undefined（回退 spec 翻译，零回归）", () => {
  expect(acceptanceCmdForSource("guardian:secret", detected)).toBeUndefined();
  expect(acceptanceCmdForSource("manual", detected)).toBeUndefined();
  expect(acceptanceCmdForSource("guardian:lint", {})).toBeUndefined();
});
