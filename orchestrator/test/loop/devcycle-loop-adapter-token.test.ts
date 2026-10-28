import { describe, expect, it } from "vitest";
import { createDevCycleRunLoop } from "../../src/loop/devcycle-loop-adapter.js";
import type { DriverEvent } from "../../src/loop/workspace-driver.js";
import { renderDriverEvent } from "../../src/server/ui/workbench-events.js";

describe("devcycle-loop-adapter 映射 token/usage", () => {
  it("token/usage KunpengEvent → DriverEvent", async () => {
    const runLoop = createDevCycleRunLoop({
      runDevCycle: async (_ws, _msg, onEvent) => {
        onEvent({ type: "token", text: "Hel" });
        onEvent({ type: "token", text: "lo" });
        onEvent({ type: "usage", input: 100, output: 7, model: "claude-opus-4-8" });
        onEvent({ type: "done", status: "verified" });
      },
      onMerge: async () => {},
      onReject: async () => {},
    });
    const handle = runLoop("ws1", "hi");
    const got: DriverEvent[] = [];
    for await (const ev of handle.events) got.push(ev);
    const tokens = got.filter((e) => e.type === "token").map((e) => (e as { text: string }).text);
    expect(tokens).toEqual(["Hel", "lo"]);
    const usage = got.find((e) => e.type === "usage") as { input?: number; output?: number } | undefined;
    expect(usage?.input).toBe(100);
    expect(usage?.output).toBe(7);
  });
});

describe("renderDriverEvent token/usage", () => {
  it("token → 内联文本(转义)", () => {
    const html = renderDriverEvent({ type: "token", text: "a<b" });
    expect(html).toContain("a&lt;b");
    expect(html).not.toContain("a<b");
  });
  it("usage → 含数字徽标", () => {
    const html = renderDriverEvent({ type: "usage", input: 100, output: 7, model: "opus" });
    expect(html).toContain("100");
    expect(html).toContain("7");
  });
});
