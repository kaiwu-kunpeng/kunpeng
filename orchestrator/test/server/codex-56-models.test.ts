import { describe, it, expect } from "vitest";
import { resolveTaskModel, chatInvocation } from "../../src/server/workspace-endpoints.js";
import { clientScript } from "../../src/server/ui/client.js";

describe("codex 5.6 三模型接入", () => {
  it("resolveTaskModel:gpt-5.6-* → codex 后端 + modelOverride", () => {
    expect(resolveTaskModel("gpt-5.6-sol")).toEqual({ backend: "codex", modelOverride: "gpt-5.6-sol" });
    expect(resolveTaskModel("gpt-5.6-terra")).toEqual({ backend: "codex", modelOverride: "gpt-5.6-terra" });
    expect(resolveTaskModel("gpt-5.6-luna")).toEqual({ backend: "codex", modelOverride: "gpt-5.6-luna" });
  });
  it("resolveTaskModel:codex 钉死 gpt-5.5(与下拉「Codex 5.5」一致);claude 不变", () => {
    expect(resolveTaskModel("codex")).toEqual({ backend: "codex", modelOverride: "gpt-5.5" });
    expect(resolveTaskModel("claude-opus-4-8")).toEqual({ modelOverride: "claude-opus-4-8" });
  });
  it("chatInvocation:codex slug 走 codex 且带 -m", () => {
    const inv = chatInvocation("gpt-5.6-terra", [], false);
    expect(inv.codex).toBe(true);
    expect(inv.bin).toBe("codex");
    const i = inv.args.indexOf("-m");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(inv.args[i + 1]).toBe("gpt-5.6-terra");
  });
  it("chatInvocation:普通 codex 显式 -m gpt-5.5(不吃 ~/.codex/config.toml 默认)", () => {
    const inv = chatInvocation("codex", [], false);
    expect(inv.codex).toBe(true);
    expect(inv.args[inv.args.indexOf("-m") + 1]).toBe("gpt-5.5");
  });
  it("chatInvocation:claude 不受影响", () => {
    const inv = chatInvocation("claude-opus-4-8", [], false);
    expect(inv.codex).toBe(false);
    expect(inv.bin).toBe("claude");
  });
  it("前端下拉含三个 5.6 选项 + clientScript 语法有效", () => {
    expect(clientScript).toContain('value="gpt-5.6-sol"');
    expect(clientScript).toContain('value="gpt-5.6-terra"');
    expect(clientScript).toContain('value="gpt-5.6-luna"');
    expect(() => new Function(clientScript)).not.toThrow();
  });
});