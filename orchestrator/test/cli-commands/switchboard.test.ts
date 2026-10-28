import { describe, it, expect } from "vitest";
import "../../src/cli-commands/switchboard.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { newSwitchMessages } from "../../src/cli.js";

describe("switchboard 命令组析出到 CLI 注册表", () => {
  it("注册了 send/kickoff/signal/inbox/escalations/switchboard-mcp/register-agent/outbox", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["send", "kickoff", "signal", "inbox", "escalations", "switchboard-mcp", "register-agent", "outbox"]) {
      expect(names).toContain(name);
    }
  });

  it("newSwitchMessages 经 cli.js re-export 仍可用且语义不变", () => {
    const all = [{ id: "a" }, { id: "b" }];
    expect(newSwitchMessages(all, new Set(["a"]))).toEqual([{ id: "b" }]);
  });
});