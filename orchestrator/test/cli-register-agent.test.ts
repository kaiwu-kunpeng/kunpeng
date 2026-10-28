import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../src/cli-commands/switchboard.js";
import { listCliCommands } from "../src/cli-commands/registry.js";
import { registerAgent } from "../src/agent/agent-registry.js";
import { PresenceStore } from "../src/switchboard/presence.js";
import { cliSource } from "./helpers/cli-source.js";
// 结构性断言:register-agent 命令已注册且接线 registerAgent;行为断言:registerAgent 真跑一遍。
describe("cli register-agent 命令已接线", () => {
  it("register-agent 已注册且命令体调 registerAgent", () => {
    const src = cliSource();
    expect(listCliCommands().map((command) => command.name)).toContain("register-agent");
    expect(src).toMatch(/registerAgent\(/);
  });

  it("registerAgent 行为:未注册目录 → 三元组 null,presence 真上线", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "kp-ra-cwd-"));
    const presence = new PresenceStore(mkdtempSync(join(tmpdir(), "kp-ra-presence-")));
    const r = await registerAgent({ instance: "probe-1", cwd, task: "探针任务", now: Date.now(), presence });
    expect(r).toEqual({ projectId: null, projectName: null, mdPath: null });
    expect(await presence.online(Date.now())).toContain("probe-1");
  });
});