import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerAgent } from "../../src/agent/agent-registry.js";
import { parseRegisterAgentArgs } from "../../src/cli-commands/switchboard.js";
import { PresenceStore } from "../../src/switchboard/presence.js";

// 背景（2026-10-03 通讯审计 A2 S2 / 总报告 P0-7 用户级部分）：交互会话的 presence 只在 SessionStart hook 跑一次 register-agent，
// 之后再没人刷，60s 窗口下会话永远"离线"。UserPromptSubmit hook 每轮再跑一次 register-agent 又会把 agents-active 登记簿
// 刷成流水账。本测试锁定 `--beat-only`：只刷同一实例的 presence（仍带 projectId / worktree / task），绝不追加登记文件。

const dirs: string[] = [];
function tmp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("register-agent --beat-only（作者锁定）", () => {
  it("参数解析：--beat-only 为 true；缺省不带该键（既有调用方形状不变）；与 --task / --pid 并存", () => {
    expect(parseRegisterAgentArgs(["--beat-only", "--task", "t", "--pid", "42"])).toEqual({ beatOnly: true, task: "t", pid: 42 });
    expect(parseRegisterAgentArgs(["--task", "t"])).toEqual({ task: "t" });
    expect(parseRegisterAgentArgs([])).toEqual({});
  });

  it("beatOnly：presence 写入且带 projectId / worktree / task；不建 agents-active 目录、mdPath 为 null；再次 beat 只更新 ts", async () => {
    const repo = tmp("kp-beat-repo-");
    const presence = new PresenceStore(join(tmp("kp-beat-state-"), "presence"));
    const inferDeps = { readSelf: (d: string) => d === repo ? { id: "demo-proj", name: "Demo" } : null, registryEntries: () => [] };
    const r1 = await registerAgent({ instance: "cc-demo-1", cwd: repo, task: "Claude Code 交互会话", now: 1000, presence, inferDeps, beatOnly: true });
    expect(r1).toEqual({ projectId: "demo-proj", projectName: "Demo", mdPath: null });
    expect(existsSync(join(repo, ".kunpeng", "agents-active"))).toBe(false);
    let hb = (await presence.list()).find((h) => h.instance === "cc-demo-1");
    expect(hb).toMatchObject({ projectId: "demo-proj", worktree: repo, task: "Claude Code 交互会话", ts: 1000 });

    const r2 = await registerAgent({ instance: "cc-demo-1", cwd: repo, task: "Claude Code 交互会话", now: 2000, presence, inferDeps, beatOnly: true });
    expect(r2.mdPath).toBeNull();
    hb = (await presence.list()).find((h) => h.instance === "cc-demo-1");
    expect(hb?.ts).toBe(2000);
    expect((await presence.list()).filter((h) => h.instance === "cc-demo-1")).toHaveLength(1);
    expect(existsSync(join(repo, ".kunpeng", "agents-active"))).toBe(false);
  });

  it("不带 beatOnly：行为不变，照样落 agents-active 登记文件", async () => {
    const repo = tmp("kp-beat-repo2-");
    const presence = new PresenceStore(join(tmp("kp-beat-state2-"), "presence"));
    const inferDeps = { readSelf: (d: string) => d === repo ? { id: "demo-proj", name: "Demo" } : null, registryEntries: () => [] };
    const r = await registerAgent({ instance: "cc-demo-2", cwd: repo, task: "t", now: 1000, presence, inferDeps });
    expect(r.mdPath).not.toBeNull();
    expect(existsSync(join(repo, ".kunpeng", "agents-active"))).toBe(true);
  });
});