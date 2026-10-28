import { describe, expect, it } from "vitest";
import { hasAgentSignal, resolveCliActor } from "../../src/runtime/cli-actor.js";

describe("hasAgentSignal", () => {
  it("CLAUDECODE=1 与非空 CODEX_ 键为真，空值与无关键为假", () => {
    expect(hasAgentSignal({ CLAUDECODE: "1" })).toBe(true);
    expect(hasAgentSignal({ CODEX_SANDBOX: "seatbelt" })).toBe(true);
    expect(hasAgentSignal({ CODEX_HOME: "" })).toBe(false);
    expect(hasAgentSignal({ CLAUDECODE: "0", HOME: "/x" })).toBe(false);
    expect(hasAgentSignal({})).toBe(false);
  });
});

describe("agent 会话不能申报 human", () => {
  it("--actor human + CLAUDECODE → agent，参数照旧剔除", () => {
    const r = resolveCliActor(["f1", "--actor", "human", "main"], { CLAUDECODE: "1" });
    expect(r.by).toBe("agent");
    expect(r.args).toEqual(["f1", "main"]);
  });

  it("KUNPENG_ACTOR=human + Codex 会话 → agent", () => {
    expect(resolveCliActor(["f1"], { KUNPENG_ACTOR: "human", CODEX_SANDBOX: "seatbelt" }).by).toBe("agent");
  });

  it("--actor human 胜过 KUNPENG_ACTOR=machine 后仍被降为 agent", () => {
    expect(resolveCliActor(["f1", "--actor", "human"], { KUNPENG_ACTOR: "machine", CLAUDECODE: "1" }).by).toBe("agent");
  });

  it("machine 申报在 agent 会话里照旧采信", () => {
    expect(resolveCliActor(["f1", "--actor", "machine"], { CLAUDECODE: "1" }).by).toBe("machine");
    expect(resolveCliActor(["f1"], { KUNPENG_ACTOR: "machine", CLAUDECODE: "1" }).by).toBe("machine");
  });

  it("无会话信号时 human 申报照旧", () => {
    expect(resolveCliActor(["f1", "--actor", "human"], {}).by).toBe("human");
    expect(resolveCliActor(["f1"], { KUNPENG_ACTOR: "human", CODEX_HOME: "" }).by).toBe("human");
  });

  it("非法 --actor 照旧抛错", () => {
    expect(() => resolveCliActor(["f1", "--actor", "root"], { CLAUDECODE: "1" })).toThrow(/--actor/);
  });
});