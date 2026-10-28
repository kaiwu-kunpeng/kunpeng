import { expect, test } from "vitest";
import { extractAcceptance, translationPrompt } from "../src/plan/acceptance.js";

test("extracts command from ```accept fenced block", () => {
  const s = "做 X。\n\n```accept\nnpx vitest run foo\n```\n";
  expect(extractAcceptance(s)).toBe("npx vitest run foo");
});

test("extracts command from 验收: line (CN/EN, full/half colon)", () => {
  expect(extractAcceptance("验收：node -e \"process.exit(0)\"")).toBe('node -e "process.exit(0)"');
  expect(extractAcceptance("Acceptance: ls foo")).toBe("ls foo");
});

test("returns null when no explicit acceptance present", () => {
  expect(extractAcceptance("只是一段普通描述，没有验收命令。")).toBeNull();
});

test("translationPrompt embeds the requirement and asks for a single runnable command", () => {
  const p = translationPrompt("做一个登录页");
  expect(p).toContain("做一个登录页");
  expect(p).toMatch(/命令|command/);
});
