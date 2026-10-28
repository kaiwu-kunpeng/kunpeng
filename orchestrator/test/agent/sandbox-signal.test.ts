import { describe, it, expect } from "vitest";
import { sandboxDecision, type SandboxDecisionInput } from "../../src/agent/sandbox-signal.js";

const ready: SandboxDecisionInput = {
  envValue: "1",
  cwd: "/repo/wt/a",
  scopeAllowCount: 2,
  available: true,
};

describe("sandboxDecision 维持 opt-in", () => {
  it("显式设成 1、后端非 codex、前置齐全时生效", () => {
    expect(sandboxDecision(ready)).toEqual({ engaged: true, reason: "engaged" });
  });

  it("不设开关时关闭", () => {
    expect(sandboxDecision({ ...ready, envValue: undefined })).toEqual({
      engaged: false,
      reason: "disabled-by-default",
    });
  });

  it("设成 0 时关闭，且优先级最高", () => {
    expect(
      sandboxDecision({ envValue: "0", cwd: undefined, scopeAllowCount: 0, available: false, backend: "codex" }),
    ).toEqual({ engaged: false, reason: "disabled-by-default" });
  });
});

describe("codex 不套 seatbelt", () => {
  it("后端为 codex 时不生效", () => {
    expect(sandboxDecision({ ...ready, backend: "codex" })).toEqual({
      engaged: false,
      reason: "codex-incompatible",
    });
  });

  it("codex 判定优先于缺 cwd、缺 scope、不可用", () => {
    expect(
      sandboxDecision({ envValue: "1", cwd: undefined, scopeAllowCount: 0, available: false, backend: "codex" }),
    ).toEqual({ engaged: false, reason: "codex-incompatible" });
  });

  it("后端为 claude 时不受影响", () => {
    expect(sandboxDecision({ ...ready, backend: "claude" })).toEqual({
      engaged: true,
      reason: "engaged",
    });
  });
});

describe("其余前置条件", () => {
  it("缺 cwd 不生效", () => {
    expect(sandboxDecision({ ...ready, cwd: undefined }).reason).toBe("no-cwd");
    expect(sandboxDecision({ ...ready, cwd: "" }).reason).toBe("no-cwd");
  });

  it("没有 scope allow 不生效", () => {
    expect(sandboxDecision({ ...ready, scopeAllowCount: 0 }).reason).toBe("no-scope");
  });

  it("sandbox-exec 不可用不生效", () => {
    expect(sandboxDecision({ ...ready, available: false }).reason).toBe("sandbox-exec-unavailable");
  });

  it("缺 cwd 优先于缺 scope，缺 scope 优先于不可用", () => {
    expect(
      sandboxDecision({ envValue: "1", cwd: undefined, scopeAllowCount: 0, available: false }).reason,
    ).toBe("no-cwd");
    expect(
      sandboxDecision({ envValue: "1", cwd: "/x", scopeAllowCount: 0, available: false }).reason,
    ).toBe("no-scope");
  });
});