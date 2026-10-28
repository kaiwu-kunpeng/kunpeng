import { describe, it, expect } from "vitest";
import { sseFrame, sseHeaders } from "../src/server/sse.js";

describe("sseFrame", () => {
  it("单行帧格式 event+data+空行结尾", () => {
    expect(sseFrame("changed")).toBe("event: changed\ndata: \n\n");
    expect(sseFrame("ping", "hi")).toBe("event: ping\ndata: hi\n\n");
  });
  it("多行 data 每行加 data: 前缀", () => {
    expect(sseFrame("x", "a\nb")).toBe("event: x\ndata: a\ndata: b\n\n");
  });
});

describe("sseHeaders", () => {
  it("是 event-stream + 禁缓存", () => {
    const h = sseHeaders();
    expect(h["content-type"]).toContain("text/event-stream");
    expect(h["cache-control"]).toContain("no-cache");
  });
});
