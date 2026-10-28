// 2026-09-28 审计 R24：对话本轮带联网或上传内容时降为 Plan；/act、/code 明确要求动手时不降。作者锁定。
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatRuleOfTwo } from "../../src/security/rule-of-two.js";
import { streamChat } from "../../src/server/chat-stream.js";
import { ConversationStore } from "../../src/chat/conversation-store.js";

describe("chatRuleOfTwo 纯函数", () => {
  test("act + 联网 → 降为 plan，三项全占", () => {
    const r = chatRuleOfTwo({ mode: "act", explicitAct: false, web: true, uploads: 0 });
    expect(r.mode).toBe("plan");
    expect(r.downgraded).toBe(true);
    expect(r.verdict.count).toBe(3);
    expect(r.verdict.requiresHumanGate).toBe(true);
  });
  test("act + 上传文件 → 降为 plan", () => {
    const r = chatRuleOfTwo({ mode: "act", explicitAct: false, web: false, uploads: 2 });
    expect(r.mode).toBe("plan");
    expect(r.downgraded).toBe(true);
  });
  test("act + 联网 + 用户明确 /act → 保持 act，不降", () => {
    const r = chatRuleOfTwo({ mode: "act", explicitAct: true, web: true, uploads: 1 });
    expect(r.mode).toBe("act");
    expect(r.downgraded).toBe(false);
    expect(r.verdict.requiresHumanGate).toBe(true);
  });
  test("act + 无联网无上传 → 保持 act，只占两项", () => {
    const r = chatRuleOfTwo({ mode: "act", explicitAct: false, web: false, uploads: 0 });
    expect(r.mode).toBe("act");
    expect(r.downgraded).toBe(false);
    expect(r.verdict.count).toBe(2);
  });
  test("本来就是 plan + 联网 → 仍是 plan，不算降级", () => {
    const r = chatRuleOfTwo({ mode: "plan", explicitAct: false, web: true, uploads: 0 });
    expect(r.mode).toBe("plan");
    expect(r.downgraded).toBe(false);
  });
});

describe("streamChat 接线：降级真的传到 CLI 参数与横幅", () => {
  let dir = "";
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kp-chat-r2-"));
    const binDir = join(dir, "bin");
    const cred = join(dir, "cred");
    await mkdir(binDir, { recursive: true });
    await mkdir(cred, { recursive: true });
    await writeFile(join(cred, "auth.json"), "{}", "utf8");
    await mkdir(join(dir, "kphome", ".kunpeng"), { recursive: true });
    await writeFile(join(dir, "kphome", ".kunpeng", "accounts.json"),
      JSON.stringify([{ id: "demo-acct", name: "demo-acct", backend: "claude", env: { CLAUDE_CONFIG_DIR: cred } }]), "utf8");
    await mkdir(join(dir, "fakehome"), { recursive: true });
    const script = [
      "#!/bin/sh",
      "cat >/dev/null",
      "printf '%s\\n' \"$@\" > '" + join(dir, "seen-args") + "'",
      "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"fake-sess-r2\"}'",
      "printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"ok\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}'",
      "exit 0",
      "",
    ].join("\n");
    await writeFile(join(binDir, "claude"), script, "utf8");
    await chmod(join(binDir, "claude"), 0o755);
    for (const key of ["KUNPENG_CHAT_BIN_DIR", "KUNPENG_STATE", "KUNPENG_BACKEND", "KUNPENG_HOME", "KUNPENG_ACCOUNTS", "HOME", "CLAUDE_CONFIG_DIR"]) saved[key] = process.env[key];
    process.env.KUNPENG_CHAT_BIN_DIR = binDir;
    process.env.KUNPENG_STATE = join(dir, "state");
    process.env.KUNPENG_HOME = join(dir, "kphome");
    process.env.HOME = join(dir, "fakehome");
    delete process.env.KUNPENG_BACKEND;
    delete process.env.KUNPENG_ACCOUNTS;
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  async function run(message: string, web: boolean): Promise<{ args: string[]; body: string }> {
    const store = new ConversationStore(join(dir, "chat"), { now: Date.now, id: () => "conv-r2-" + Math.random().toString(36).slice(2) });
    const server = createServer((_req, res) => {
      void streamChat("kunpeng", message, "claude-fable-5-1", [], web, dir, res, {
        store, username: "accept", projectId: "kunpeng", mode: "act",
      }).catch(error => res.destroy(error instanceof Error ? error : new Error(String(error))));
    });
    try {
      await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");
      const response = await fetch("http://127.0.0.1:" + address.port, { signal: AbortSignal.timeout(20000) });
      const body = await response.text();
      const args = (await readFile(join(dir, "seen-args"), "utf8")).split("\n");
      return { args, body };
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r, reject) => server.close(error => error ? reject(error) : r()));
    }
  }

  function permissionMode(args: string[]): string | undefined {
    const i = args.indexOf("--permission-mode");
    return i >= 0 ? args[i + 1] : undefined;
  }

  test("act + 联网：CLI 以 plan 权限启动，横幅说明 Rule of Two 与 /act", async () => {
    const { args, body } = await run("帮我看看这个网页说了什么", true);
    expect(permissionMode(args)).toBe("plan");
    expect(body).toContain("Rule of Two");
    expect(body).toContain("/act");
  });

  test("对照组 act + 不联网：仍以 bypassPermissions 启动，没有 Rule of Two 横幅", async () => {
    const { args, body } = await run("帮我改一下 README", false);
    expect(permissionMode(args)).toBe("bypassPermissions");
    expect(body).not.toContain("Rule of Two");
  });

  test("act + 联网 + 用户用 /act 开头：保持 bypassPermissions", async () => {
    const { args, body } = await run("/act 按网页上的步骤改配置", true);
    expect(permissionMode(args)).toBe("bypassPermissions");
    expect(body).not.toContain("Rule of Two");
  });
});