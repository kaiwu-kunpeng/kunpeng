import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { chatFallbackModel, fallbackBannerHtml } from "../../src/server/chat-model-fallback.js";
import { streamChat } from "../../src/server/chat-stream.js";
import { ConversationStore } from "../../src/chat/conversation-store.js";

const LIMIT_TEXT = "You've reached your Fable limit. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue.";

describe("额度用尽自动降级：备用模型表（作者锁定）", () => {
  test("claude 系按档位降一级，末档与非 claude 后端无备用", () => {
    expect(chatFallbackModel("claude-fable-5-1")).toBe("claude-opus-5");
    expect(chatFallbackModel("claude-fable-5")).toBe("claude-opus-5");
    expect(chatFallbackModel("claude-opus-5")).toBe("claude-sonnet-5");
    expect(chatFallbackModel("claude-opus-5[1m]")).toBe("claude-sonnet-5");
    expect(chatFallbackModel("claude-opus-4-8")).toBe("claude-sonnet-5");
    expect(chatFallbackModel("claude-sonnet-5")).toBe("claude-sonnet-4-6");
    expect(chatFallbackModel("claude-sonnet-4-6")).toBeUndefined();
    expect(chatFallbackModel("codex")).toBeUndefined();
    expect(chatFallbackModel("gpt-6-astra")).toBeUndefined();
    expect(chatFallbackModel("")).toBeUndefined();
  });
  test("降级横幅写明从哪到哪、且会话模型设置未变", () => {
    const html = fallbackBannerHtml("claude-fable-5-1", "claude-opus-5");
    expect(html).toContain("claude-fable-5-1 额度用尽");
    expect(html).toContain("已自动改用 claude-opus-5");
    expect(html).toContain("会话模型设置未变");
    expect(html.startsWith('<div class="kp-ev kp-ev-stage">')).toBe(true);
  });
});

describe("真串线：假 claude 对 fable 撞限、对 opus 正常，一轮内自动降级（作者锁定）", () => {
  let dir = "";
  let modelLog = "";
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kp-chat-fallback-"));
    const binDir = join(dir, "bin");
    modelLog = join(dir, "models.log");
    await mkdir(binDir, { recursive: true });
    const limitLine = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: LIMIT_TEXT, usage: { input_tokens: 0, output_tokens: 0 } }).replace(/'/g, "'\"'\"'");
    const script = [
      "#!/bin/sh",
      "cat >/dev/null",
      "model=\"\"; prev=\"\"",
      "for a in \"$@\"; do if [ \"$prev\" = \"--model\" ]; then model=\"$a\"; fi; prev=\"$a\"; done",
      "echo \"$model\" >> \"$KP_FAKE_MODEL_LOG\"",
      "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"fake-sess-fb\"}'",
      "limit=0; case \"$model\" in claude-fable*) limit=1;; esac",
      "if [ -n \"$KP_FAKE_ALWAYS_LIMIT\" ]; then limit=1; fi",
      "if [ \"$limit\" = 1 ]; then printf '%s\\n' '" + limitLine + "'; exit 1; fi",
      "printf '%s\\n' '{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"好\"}}}'",
      "printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"好\",\"usage\":{\"input_tokens\":3,\"output_tokens\":1},\"modelUsage\":{\"'\"$model\"'\":{\"inputTokens\":3}}}'",
      "exit 0",
      "",
    ].join("\n");
    await writeFile(join(binDir, "claude"), script, "utf8");
    await chmod(join(binDir, "claude"), 0o755);
    for (const key of ["KUNPENG_CHAT_BIN_DIR", "KUNPENG_STATE", "KUNPENG_BACKEND", "KP_FAKE_MODEL_LOG", "KP_FAKE_ALWAYS_LIMIT"]) savedEnv[key] = process.env[key];
    process.env.KUNPENG_CHAT_BIN_DIR = binDir;
    process.env.KUNPENG_STATE = join(dir, "state");
    process.env.KP_FAKE_MODEL_LOG = modelLog;
    delete process.env.KUNPENG_BACKEND;
    delete process.env.KP_FAKE_ALWAYS_LIMIT;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  async function runOnce(convId: string): Promise<{ body: string; store: ConversationStore }> {
    const store = new ConversationStore(join(dir, "chat"), { now: Date.now, id: () => convId });
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
      return { body: await response.text(), store };
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }

  test("fable 撞限 → 同一轮改用 opus 重跑：横幅 + 正文「好」+ 落盘无错 + 会话模型未变 + 用量记在 opus 名下", async () => {
    const { body, store } = await runOnce("conv-fallback-ok");
    expect((await readFile(modelLog, "utf8")).trim().split("\n")).toEqual(["claude-fable-5-1", "claude-opus-5"]);
    expect(body).toContain("claude-fable-5-1 额度用尽");
    expect(body).toContain("已自动改用 claude-opus-5");
    expect(body).toContain("好");
    expect(body).not.toContain("⚠️");
    const saved = await store.get("accept", "conv-fallback-ok");
    const last = saved?.turns[saved.turns.length - 1];
    expect(last?.role).toBe("assistant");
    expect(last?.text).toBe("好");
    expect(last?.usage?.model).toBe("claude-opus-5");
    expect(saved?.model).toBe("claude-fable-5-1");
  });

  test("备用模型也撞限 → 只降级一次，最终如实报「模型额度用尽」", async () => {
    process.env.KP_FAKE_ALWAYS_LIMIT = "1";
    const { body, store } = await runOnce("conv-fallback-twice");
    expect((await readFile(modelLog, "utf8")).trim().split("\n")).toEqual(["claude-fable-5-1", "claude-opus-5"]);
    expect(body).toContain("已自动改用 claude-opus-5");
    expect(body).toContain("模型额度用尽");
    const saved = await store.get("accept", "conv-fallback-twice");
    const last = saved?.turns[saved.turns.length - 1];
    expect(last?.text).toContain("⚠️[本轮出错:模型额度用尽");
  });
});