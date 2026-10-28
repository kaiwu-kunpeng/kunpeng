import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaudeStreamLine } from "../../src/agent/cli-stream-parse.js";
import { resolveChatReplyText } from "../../src/server/chat-stream.js";
import { clientScript } from "../../src/server/ui/client.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

describe("块一 · 工具参数流透出字符数", () => {
  it("input_json_delta 被解析成 toolInputChars,且不回传正文", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: '{"content":"acme-report' },
      },
    });
    const parsed = parseClaudeStreamLine(line) as { toolInputChars?: number; text?: string };
    expect(parsed?.toolInputChars).toBe('{"content":"acme-report'.length);
    expect(parsed?.text).toBeUndefined();
  });

  it("text_delta 行为不变", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "你好" } },
    });
    expect((parseClaudeStreamLine(line) as { text?: string })?.text).toBe("你好");
  });
});

describe("块三 · 墙钟放宽到 3 小时", () => {
  it("chat-stream 传的 timeoutMs 是 10_800_000,idle 仍是 300_000", () => {
    const src = readFileSync(join(srcDir, "server", "chat-stream.ts"), "utf8");
    expect(src).toContain("10_800_000");
    expect(src).toContain("300_000");
    expect(src).not.toContain("1_800_000");
  });
});

describe("块四 · 终止原因分三种文案", () => {
  it("墙钟终止说明是跑满上限", () => {
    const out = resolveChatReplyText("正文", true, "wall");
    expect(out).toContain("正文");
    expect(out).toContain("3 小时");
    expect(out).toContain("并未执行");
  });

  it("空闲终止说明是无输出卡死", () => {
    expect(resolveChatReplyText("正文", true, "idle")).toContain("无任何输出");
  });

  it("不传原因时与改动前一致", () => {
    expect(resolveChatReplyText("正文", true)).toContain("本轮连接中断");
  });

  it("未中断时不加任何标记", () => {
    expect(resolveChatReplyText("正文", false)).toBe("正文");
  });
});

describe("块五六七 · 前端不再一键误杀", () => {
  it("clientScript 语法有效(防 SPA 整页崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  it("Esc 需要二次确认才停止", () => {
    expect(clientScript).toContain("再按一次 Esc");
  });

  it("停止按钮带悬停提示,且说明排队消息保留", () => {
    expect(clientScript).toContain("终止本轮生成");
    expect(clientScript).toContain("排队消息会保留");
  });

  it("仍然保留显式 /stop 这条全停通道", () => {
    expect(clientScript).toContain('"/stop"');
  });
});