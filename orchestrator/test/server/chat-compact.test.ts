import { describe, it, expect } from "vitest";
import { buildReplayTurns } from "../../src/server/chat-persistence.js";

const turns = [
  { role: "user", text: "a", at: 1 },
  { role: "assistant", text: "ra", at: 2 },
  { role: "user", text: "/compact", at: 3 },
  { role: "assistant", text: "摘要X", at: 4, compact: true },
  { role: "user", text: "b", at: 5 },
  { role: "assistant", text: "rb", at: 6 },
];

describe("CM-1:压缩点重放", () => {
  it("有压缩点:从最后压缩摘要轮开始重放", () => {
    const replay = buildReplayTurns({ turns } as never);
    expect(replay.map((t) => t.text)).toEqual(["【前文摘要】摘要X", "b", "rb"]);
  });

  it("excludeLastRound 在截取后序列上生效", () => {
    const replay = buildReplayTurns({ turns } as never, true);
    expect(replay.map((t) => t.text)).toEqual(["【前文摘要】摘要X"]);
  });

  it("无压缩点:保持原全量重放", () => {
    const plain = turns.filter((t) => t.compact !== true).slice(0, 2);
    const replay = buildReplayTurns({ turns: plain } as never);
    expect(replay.map((t) => t.text)).toEqual(["a", "ra"]);
  });

  it("多个压缩点取最后一个", () => {
    const multi = [
      { role: "assistant", text: "旧摘要", at: 1, compact: true },
      { role: "user", text: "x", at: 2 },
      { role: "assistant", text: "新摘要", at: 3, compact: true },
      { role: "user", text: "y", at: 4 },
    ];
    const replay = buildReplayTurns({ turns: multi } as never);
    expect(replay.map((t) => t.text)).toEqual(["【前文摘要】新摘要", "y"]);
  });
});
