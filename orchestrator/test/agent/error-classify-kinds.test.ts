import { describe, expect, it } from "vitest";
import { classifyCliFailure, isBackendDownKind, isModelDownKind } from "../../src/agent/error-classify.js";

describe("CLI 失败分类带 kind（作者锁定）", () => {
  it("auth / quota 不可重试但各有 kind，旧的 transient 语义不变", () => {
    expect(classifyCliFailure(1, "HTTP 401 Unauthorized")).toMatchObject({ transient: false, kind: "auth" });
    expect(classifyCliFailure(1, "", "Error: 403 Forbidden")).toMatchObject({ transient: false, kind: "auth" });
    expect(classifyCliFailure(1, "Not logged in · Please run /login")).toMatchObject({ transient: false, kind: "auth" });
    expect(classifyCliFailure(1, "usage limit reached, resets in 3h (429 window)")).toMatchObject({ transient: false, kind: "quota", reason: "usage limit reached" });
    expect(classifyCliFailure(1, "Your credit balance is too low")).toMatchObject({ transient: false, kind: "quota" });
    expect(classifyCliFailure(1, "quota exhausted for this billing period")).toMatchObject({ kind: "quota" });
  });

  it("model-unavailable 单独成类", () => {
    expect(classifyCliFailure(1, "API Error: 404 model claude-opus-5 not found")).toMatchObject({ transient: false, kind: "model-unavailable" });
    expect(classifyCliFailure(1, "", "error: unknown model 'gpt-6-astra'")).toMatchObject({ kind: "model-unavailable" });
    expect(classifyCliFailure(1, "The model gpt-5.6-terra has been retired")).toMatchObject({ kind: "model-unavailable" });
  });

  it("transient / fatal / killed / unknown", () => {
    expect(classifyCliFailure(1, "429 Too Many Requests")).toMatchObject({ transient: true, kind: "transient" });
    expect(classifyCliFailure(1, "ECONNRESET")).toMatchObject({ transient: true, kind: "transient" });
    expect(classifyCliFailure(2, "error: unknown option '--foo'")).toMatchObject({ transient: false, kind: "fatal" });
    expect(classifyCliFailure(null, "")).toMatchObject({ transient: false, kind: "killed", reason: "killed" });
    expect(classifyCliFailure(1, "")).toMatchObject({ transient: false, kind: "unknown", reason: "unknown" });
  });

  it("谓词：auth/quota 标后端下线，model-unavailable 标模型下线", () => {
    expect(isBackendDownKind("auth")).toBe(true);
    expect(isBackendDownKind("quota")).toBe(true);
    expect(isBackendDownKind("transient")).toBe(false);
    expect(isBackendDownKind("model-unavailable")).toBe(false);
    expect(isModelDownKind("model-unavailable")).toBe(true);
    expect(isModelDownKind("auth")).toBe(false);
  });
});