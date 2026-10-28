import { describe, it, expect } from "vitest";
import { summarizeChannels } from "../../src/server/evolution-channels.js";

describe("summarizeChannels 按通道汇总", () => {
  it("分组计数 + 固定通道顺序 + 记录最新证据态", () => {
    const out = summarizeChannels([
      { channel: "security", evidenceState: "tested" },
      { channel: "ears", evidenceState: "untested" },
      { channel: "ears", evidenceState: "tested" },
      { channel: "module" },
    ]);
    // 固定顺序 ears 在 security 之前
    expect(out.map((c) => c.channel)).toEqual(["ears", "module", "security"]);
    const ears = out.find((c) => c.channel === "ears")!;
    expect(ears.count).toBe(2);
    expect(ears.latestState).toBe("tested"); // 最后一个 ears 的态
    expect(out.find((c) => c.channel === "security")!.count).toBe(1);
  });
  it("跳过无 channel 的项；空输入→空数组", () => {
    expect(summarizeChannels([])).toEqual([]);
    expect(summarizeChannels([{ evidenceState: "tested" }])).toEqual([]);
  });
});
