import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { parseClaudeStreamLine } from "../../src/agent/cli-stream-parse.js";
import { describeChatExit, isModelLimitError } from "../../src/server/chat-exit-reason.js";
import { binEnv, resolveChatReplyText, streamChat } from "../../src/server/chat-stream.js";
import { ConversationStore } from "../../src/chat/conversation-store.js";

const LIMIT_TEXT = "You've reached your Fable limit. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue.";

describe("对话 exit 1 必须透出 claude 的真实原因（作者锁定）", () => {
  test("parseClaudeStreamLine 把 result.is_error 的正文放进 delta.error", () => {
    const errLine = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: LIMIT_TEXT, usage: { input_tokens: 0, output_tokens: 0 } });
    const okLine = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "好", usage: { input_tokens: 1, output_tokens: 1 } });
    expect(parseClaudeStreamLine(errLine)?.error).toBe(LIMIT_TEXT);
    expect(parseClaudeStreamLine(okLine)?.error).toBeUndefined();
    expect(parseClaudeStreamLine(okLine)?.final).toBe("好");
  });

  test("isModelLimitError 只认额度用尽类文案", () => {
    expect(isModelLimitError(LIMIT_TEXT)).toBe(true);
    expect(isModelLimitError("You've reached your Opus limit. Switch to another model")).toBe(true);
    expect(isModelLimitError("403 Request not allowed")).toBe(false);
    expect(isModelLimitError(undefined)).toBe(false);
    expect(isModelLimitError("")).toBe(false);
  });

  test("describeChatExit：额度用尽 → 中文说明 + 原文；其它错 → exit 码 + 正文/stderr 尾巴", () => {
    const limit = describeChatExit(1, LIMIT_TEXT, "");
    expect(limit.startsWith("模型额度用尽")).toBe(true);
    expect(limit).toContain(LIMIT_TEXT);
    expect(limit).not.toContain("无 stderr 输出");
    expect(describeChatExit(1, "403 Request not allowed", "")).toBe("对话进程异常退出(exit 1):403 Request not allowed");
    expect(describeChatExit(1, undefined, "boom\n")).toBe("对话进程异常退出(exit 1):boom");
    expect(describeChatExit(1, undefined, "")).toBe("对话进程异常退出(exit 1)");
    expect(describeChatExit(2, undefined, "x".repeat(600))).toBe("对话进程异常退出(exit 2):" + "x".repeat(500));
    expect(resolveChatReplyText("", false, undefined, limit)).toContain("⚠️[本轮出错:模型额度用尽");
  });

  test("binEnv：KUNPENG_CHAT_BIN_DIR 排在 PATH 最前，缺省时 PATH 不变", () => {
    const before = binEnv().PATH;
    const prev = process.env.KUNPENG_CHAT_BIN_DIR;
    process.env.KUNPENG_CHAT_BIN_DIR = "/tmp/kp-fake-bin-dir";
    try {
      expect(binEnv().PATH.split(":")[0]).toBe("/tmp/kp-fake-bin-dir");
    } finally {
      if (prev === undefined) delete process.env.KUNPENG_CHAT_BIN_DIR; else process.env.KUNPENG_CHAT_BIN_DIR = prev;
    }
    expect(binEnv().PATH).toBe(before);
  });
});

describe("真串线：假 claude 撞额度上限，SSE 与落盘记录都写明真因（作者锁定）", () => {
  let dir = "";
  let binDir = "";
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kp-chat-exit-reason-"));
    binDir = join(dir, "bin");
    await mkdir(binDir, { recursive: true });
    const script = [
      "#!/bin/sh",
      "cat >/dev/null",
      "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"fake-sess-limit\"}'",
      "printf '%s\\n' '" + JSON.stringify({ type: "result", subtype: "success", is_error: true, result: LIMIT_TEXT, usage: { input_tokens: 0, output_tokens: 0 } }).replace(/'/g, "'\"'\"'") + "'",
      "exit 1",
      "",
    ].join("\n");
    await writeFile(join(binDir, "claude"), script, "utf8");
    await chmod(join(binDir, "claude"), 0o755);
    for (const key of ["KUNPENG_CHAT_BIN_DIR", "KUNPENG_STATE", "KUNPENG_BACKEND"]) savedEnv[key] = process.env[key];
    process.env.KUNPENG_CHAT_BIN_DIR = binDir;
    process.env.KUNPENG_STATE = join(dir, "state");
    delete process.env.KUNPENG_BACKEND;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  test("撞限那轮：SSE 帧含「模型额度用尽」，落盘 turn 文本含真因、不含「无 stderr 输出」", async () => {
    const store = new ConversationStore(join(dir, "chat"), { now: Date.now, id: () => "conv-limit-accept" });
    const server = createServer((_req, res) => {
      void streamChat("kunpeng", "你好", "claude-fable-5-1", [], false, dir, res, {
        store, username: "accept", projectId: "kunpeng", kunpengHome: dir,
      }).catch(error => res.destroy(error instanceof Error ? error : new Error(String(error))));
    });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");
      const response = await fetch("http://127.0.0.1:" + address.port, { signal: AbortSignal.timeout(20000) });
      const body = await response.text();
      expect(body).toContain("模型额度用尽");
      expect(body).toContain("Fable limit");
      expect(body).not.toContain("无 stderr 输出");
      const saved = await store.get("accept", "conv-limit-accept");
      const last = saved?.turns[saved.turns.length - 1];
      expect(last?.role).toBe("assistant");
      expect(last?.text).toContain("⚠️[本轮出错:模型额度用尽");
      expect(last?.text).toContain("Fable limit");
      expect(last?.text).not.toContain("无 stderr 输出");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});