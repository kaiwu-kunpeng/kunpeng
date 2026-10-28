import { describe, expect, test } from "vitest";
import { reportExecutionPosture } from "../../src/agent/execution-posture.js";

describe("reportExecutionPosture 本地反位可观测", () => {
  test("默认(无后端 env、无 API key) → 本地反位完整成立", () => {
    const p = reportExecutionPosture({});
    expect(p.kind).toBe("local");
    expect(p.localOnly).toBe(true);
    expect(p.credentialsLocal).toBe(true);
    expect(p.offlineCapable).toBe(true);
    expect(p.notes.some((n) => n.includes("本地反位成立"))).toBe(true);
  });

  test("codex-cloud 后端 → 非本地反位(localOnly false, offlineCapable false)", () => {
    const p = reportExecutionPosture({ KUNPENG_EXECUTION_BACKEND: "codex-cloud" });
    expect(p.localOnly).toBe(false);
    expect(p.offlineCapable).toBe(false);
    expect(p.notes.some((n) => n.includes("代码会上云"))).toBe(true);
  });

  test("注入 OPENAI_API_KEY → credentialsLocal false, offlineCapable false", () => {
    const p = reportExecutionPosture({ OPENAI_API_KEY: "sk-xxx" });
    expect(p.credentialsLocal).toBe(false);
    expect(p.offlineCapable).toBe(false);
    expect(p.notes.some((n) => n.includes("凭据可能外发"))).toBe(true);
  });

  test("注入 ANTHROPIC_API_KEY 同样判非本机凭据", () => {
    const p = reportExecutionPosture({ ANTHROPIC_API_KEY: "sk-ant-xxx" });
    expect(p.credentialsLocal).toBe(false);
  });

  test("local 后端但有 API key → 执行本机但凭据外发,offlineCapable false", () => {
    const p = reportExecutionPosture({ KUNPENG_EXECUTION_BACKEND: "local", OPENAI_API_KEY: "sk" });
    expect(p.localOnly).toBe(true);
    expect(p.credentialsLocal).toBe(false);
    expect(p.offlineCapable).toBe(false);
  });
});