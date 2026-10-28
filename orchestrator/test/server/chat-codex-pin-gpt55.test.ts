import { describe, expect, test } from "vitest";
import { chatInvocation } from "../../src/server/chat-stream.js";
import { resolveTaskModel } from "../../src/server/workspace-driver-deps.js";

describe("下拉「Codex 5.5」钉死 gpt-5.5(作者锁定)", () => {
  test("chatInvocation(codex) 显式 -m gpt-5.5,不再依赖 ~/.codex/config.toml 默认模型", () => {
    const inv = chatInvocation("codex", [], false);
    expect(inv.bin).toBe("codex");
    expect(inv.codex).toBe(true);
    const i = inv.args.indexOf("-m");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(inv.args[i + 1]).toBe("gpt-5.5");
    expect(inv.args.filter((a) => a === "-m")).toHaveLength(1);
  });
  test("plan 模式下仍是 -m gpt-5.5 且只读沙箱", () => {
    const inv = chatInvocation("codex", [], false, undefined, false, undefined, "plan");
    expect(inv.args[inv.args.indexOf("-m") + 1]).toBe("gpt-5.5");
    expect(inv.args[inv.args.indexOf("--sandbox") + 1]).toBe("read-only");
  });
  test("resolveTaskModel(codex) → codex 后端 + modelOverride gpt-5.5", () => {
    expect(resolveTaskModel("codex")).toEqual({ backend: "codex", modelOverride: "gpt-5.5" });
  });
  test("其它 codex slug 与 claude 不受影响", () => {
    const astra = chatInvocation("gpt-6-astra", [], false).args;
    expect(astra[astra.indexOf("-m") + 1]).toBe("gpt-6-astra");
    expect(resolveTaskModel("gpt-5.6-sol")).toEqual({ backend: "codex", modelOverride: "gpt-5.6-sol" });
    expect(chatInvocation("claude-opus-5", [], false).bin).toBe("claude");
    expect(resolveTaskModel("claude-opus-5")).toEqual({ modelOverride: "claude-opus-5" });
  });
});