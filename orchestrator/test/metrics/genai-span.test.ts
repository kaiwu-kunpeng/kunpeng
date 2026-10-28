import { describe, it, expect } from "vitest";
import { buildGenAiSpan } from "../../src/metrics/genai-span.js";

describe("buildGenAiSpan", () => {
  it("映射到 gen_ai.* 标准属性 + kunpeng 前缀的 duration/ok", () => {
    const s = buildGenAiSpan({
      stage: "implement", model: "codex", backend: "codex",
      inputTokens: 100, outputTokens: 250, durationMs: 4200, ok: true,
    });
    expect(s.name).toBe("gen_ai.implement");
    expect(s.attributes["gen_ai.operation.name"]).toBe("implement");
    expect(s.attributes["gen_ai.request.model"]).toBe("codex");
    expect(s.attributes["gen_ai.system"]).toBe("codex");
    expect(s.attributes["gen_ai.usage.input_tokens"]).toBe(100);
    expect(s.attributes["gen_ai.usage.output_tokens"]).toBe(250);
    expect(s.attributes["kunpeng.stage.duration_ms"]).toBe(4200);
    expect(s.attributes["kunpeng.stage.ok"]).toBe(true);
  });
  it("undefined 字段不出现在 attributes", () => {
    const s = buildGenAiSpan({ stage: "spec" });
    expect(s.attributes["gen_ai.operation.name"]).toBe("spec");
    expect("gen_ai.request.model" in s.attributes).toBe(false);
    expect("gen_ai.usage.input_tokens" in s.attributes).toBe(false);
    expect("kunpeng.stage.ok" in s.attributes).toBe(false);
  });
  it("ok=false 是 boolean 也填(不被当 falsy 漏掉)", () => {
    const s = buildGenAiSpan({ stage: "verify", ok: false, inputTokens: 0 });
    expect(s.attributes["kunpeng.stage.ok"]).toBe(false);
    expect(s.attributes["gen_ai.usage.input_tokens"]).toBe(0);
  });
});
