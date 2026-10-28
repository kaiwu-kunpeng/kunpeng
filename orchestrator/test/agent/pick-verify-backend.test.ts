import { afterEach, beforeEach, expect, test } from "vitest";
import { pickVerifyBackend, resolveBackend, type Backend } from "../../src/agent/backend-routing.js";

const both = () => new Set<Backend>(["claude", "codex"]);
const only = (b: Backend) => new Set<Backend>([b]);
const noEnv = { env: {} as NodeJS.ProcessEnv };

let savedVerify: string | undefined;
let savedForced: string | undefined;
beforeEach(() => {
  savedVerify = process.env.KUNPENG_VERIFY_BACKEND;
  savedForced = process.env.KUNPENG_BACKEND;
  delete process.env.KUNPENG_VERIFY_BACKEND;
  delete process.env.KUNPENG_BACKEND;
});
afterEach(() => {
  if (savedVerify === undefined) delete process.env.KUNPENG_VERIFY_BACKEND; else process.env.KUNPENG_VERIFY_BACKEND = savedVerify;
  if (savedForced === undefined) delete process.env.KUNPENG_BACKEND; else process.env.KUNPENG_BACKEND = savedForced;
});

test("默认选与实现者不同的后端：codex 干活 → claude 评估，反之亦然", () => {
  expect(pickVerifyBackend("codex", both(), noEnv)).toEqual({ backend: "claude", source: "other" });
  expect(pickVerifyBackend("claude", both(), noEnv)).toEqual({ backend: "codex", source: "other" });
});

test("只有一个后端可用时退回同后端并标 same；一个都没有返回 null", () => {
  expect(pickVerifyBackend("claude", only("claude"), noEnv)).toEqual({ backend: "claude", source: "same" });
  expect(pickVerifyBackend("codex", only("codex"), noEnv)).toEqual({ backend: "codex", source: "same" });
  expect(pickVerifyBackend("codex", new Set<Backend>(), noEnv)).toBeNull();
});

test("实现者后端未知时按 claude→codex 顺序取第一个可用，标 other", () => {
  expect(pickVerifyBackend(undefined, both(), noEnv)).toEqual({ backend: "claude", source: "other" });
  expect(pickVerifyBackend(undefined, only("codex"), noEnv)).toEqual({ backend: "codex", source: "other" });
});

test("KUNPENG_VERIFY_BACKEND 显式覆盖：可用就用（哪怕与实现者同后端），不可用或非法值则忽略", () => {
  expect(pickVerifyBackend("codex", both(), { env: { KUNPENG_VERIFY_BACKEND: "codex" } })).toEqual({ backend: "codex", source: "env" });
  expect(pickVerifyBackend("codex", only("claude"), { env: { KUNPENG_VERIFY_BACKEND: "codex" } })).toEqual({ backend: "claude", source: "other" });
  expect(pickVerifyBackend("codex", both(), { env: { KUNPENG_VERIFY_BACKEND: "gemini" } })).toEqual({ backend: "claude", source: "other" });
  process.env.KUNPENG_VERIFY_BACKEND = "codex";
  expect(pickVerifyBackend("codex", both())).toEqual({ backend: "codex", source: "env" });
});

test("forced（KUNPENG_BACKEND 逃生口）压过“换后端”，但压不过显式 KUNPENG_VERIFY_BACKEND", () => {
  expect(pickVerifyBackend("claude", both(), { env: {}, forced: "claude" })).toEqual({ backend: "claude", source: "same" });
  expect(pickVerifyBackend("claude", both(), { env: { KUNPENG_VERIFY_BACKEND: "codex" }, forced: "claude" })).toEqual({ backend: "codex", source: "env" });
  expect(pickVerifyBackend("claude", only("codex"), { env: {}, forced: "claude" })).toEqual({ backend: "codex", source: "other" });
});

test("resolveBackend 带 avoid：优先另一后端且不算 fellBack；不带 avoid 时行为不变", () => {
  expect(resolveBackend("verify", { available: both(), avoid: "claude", env: {} })).toEqual({ backend: "codex", fellBack: false });
  expect(resolveBackend("verify", { available: both(), avoid: "codex", env: {} })).toEqual({ backend: "claude", fellBack: false });
  expect(resolveBackend("verify", { available: only("claude"), avoid: "claude", env: {} })).toEqual({ backend: "claude", fellBack: false });
  expect(resolveBackend("verify", { available: both(), down: new Set<Backend>(["codex"]), avoid: "claude", env: {} })).toEqual({ backend: "claude", fellBack: false });
  expect(resolveBackend("verify", { available: both(), avoid: "claude", forced: "claude", env: {} })).toEqual({ backend: "claude", fellBack: false });
  expect(resolveBackend("verify", { available: both(), env: {} })).toEqual({ backend: "claude", fellBack: false });
  expect(resolveBackend("verify", { available: both(), down: new Set<Backend>(["claude", "codex"]), avoid: "claude", env: {} })).toBeNull();
});