import { describe, expect, it } from "vitest";
import { createChatRun, getChatRun, chatRunKey } from "../src/server/chat-run-bus.js";

function fakeRes() {
  const chunks: string[] = [];
  return { chunks, write(chunk: string) { chunks.push(chunk); return true; } };
}

describe("chat-run-bus", () => {
  it("chatRunKey 拼接 username/convId", () => {
    expect(chatRunKey("u1", "c1")).toBe("u1/c1");
  });

  it("缓冲并按 seq 重放:晚订阅者拿到断点之后的帧", () => {
    const run = createChatRun("u/c1");
    run.emit("<a>");
    run.emit("<b>");
    const res = fakeRes();
    run.subscribe(res, 1);
    const replayed = res.chunks.join("");
    expect(replayed).toContain("id: 2");
    expect(replayed).toContain("<b>");
    expect(replayed).not.toContain("<a>");
    run.emit("<c>");
    expect(res.chunks.join("")).toContain("<c>");
  });

  it("订阅者断开只解除订阅,不触发 abort,生成继续", () => {
    const run = createChatRun("u/c2");
    let aborted = false;
    run.bindAbort(() => { aborted = true; });
    const res = fakeRes();
    const detach = run.subscribe(res, 0);
    detach();
    run.emit("<x>");
    expect(aborted).toBe(false);
    expect(res.chunks.join("")).not.toContain("<x>");
  });

  it("显式 abort 走绑定的中止回调", () => {
    const run = createChatRun("u/c3");
    let aborted = false;
    run.bindAbort(() => { aborted = true; });
    run.abort();
    expect(aborted).toBe(true);
  });

  it("endRun 后 TTL 内仍可 attach:重放尾部并立即收到 end 帧", () => {
    const run = createChatRun("u/c4");
    run.emit("<tail>");
    run.endRun();
    expect(getChatRun("u/c4")).toBe(run);
    const res = fakeRes();
    run.subscribe(res, 0);
    const out = res.chunks.join("");
    expect(out).toContain("<tail>");
    expect(out).toContain("event: end");
  });

  it("同 key 新 run 顶替旧 run 成为最新可寻址 run", () => {
    const first = createChatRun("u/c5");
    const second = createChatRun("u/c5");
    expect(getChatRun("u/c5")).toBe(second);
    expect(first).not.toBe(second);
  });
});