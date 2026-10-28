import { describe, it, expect } from "vitest";
import { createChatRun } from "../../src/server/chat-run-bus.js";

function collect(): { res: { write(c: string): void }; out: string[] } {
  const out: string[] = [];
  return { res: { write(c: string) { out.push(c); } }, out };
}

/** 按 SSE 语义把一个 chunk 还原成 data 内容：取 data: 行、去前缀、用 \n 拼回。 */
function decodeSse(chunk: string): string {
  return chunk
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .join("\n");
}

describe("SSE 多行拆帧", () => {
  it("含换行的 HTML 每行都以 data: 开头，重组后与原文逐字一致", () => {
    const run = createChatRun("u/sse-multiline-1");
    const sink = collect();
    run.subscribe(sink.res, 0);
    const html = "foo\nbar\n<span>baz</span>";
    run.emit(html);

    expect(sink.out.length).toBe(1);
    const chunk = sink.out[0] as string;
    const lines = chunk.replace(/\n\n$/, "").split("\n");
    expect(lines[0]).toBe("id: 1");
    for (const line of lines.slice(1)) {
      expect(line.startsWith("data: "), `非 data 行: ${JSON.stringify(line)}`).toBe(true);
    }
    expect(decodeSse(chunk)).toBe(html);
  });

  it("不含换行时行为不变", () => {
    const run = createChatRun("u/sse-multiline-2");
    const sink = collect();
    run.subscribe(sink.res, 0);
    run.emit("plain");
    expect(sink.out[0]).toBe("id: 1\ndata: plain\n\n");
  });

  it("重连回放的帧与直播帧逐字一致", () => {
    const run = createChatRun("u/sse-multiline-3");
    const live = collect();
    run.subscribe(live.res, 0);
    const html = "line1\nline2";
    run.emit(html);

    const replay = collect();
    run.subscribe(replay.res, 0);
    expect(replay.out[0]).toBe(live.out[0]);
    expect(decodeSse(replay.out[0] as string)).toBe(html);
  });
});