import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { readLimitedJsonBody } from "../../src/server/http.js";

type MockRequest = EventEmitter & Parameters<typeof readLimitedJsonBody>[0];

function mockReq(): MockRequest {
  const req = new EventEmitter() as MockRequest;
  req.resume = () => req;
  return req;
}

describe("请求体大小上限(作者验收)", () => {
  it("超过上限 → 413", async () => {
    const req = mockReq();
    const p = readLimitedJsonBody(req, 10);
    req.emit("data", Buffer.from("0123456789ABCDEF"));
    expect(await p).toEqual({ ok: false, status: 413 });
  });

  it("合法小 JSON → ok+body", async () => {
    const req = mockReq();
    const p = readLimitedJsonBody(req, 1024);
    req.emit("data", Buffer.from('{"a":1}'));
    req.emit("end");
    expect(await p).toEqual({ ok: true, body: { a: 1 } });
  });

  it("非法 JSON → ok+空 body(容错)", async () => {
    const req = mockReq();
    const p = readLimitedJsonBody(req, 1024);
    req.emit("data", Buffer.from("{ broken"));
    req.emit("end");
    expect(await p).toEqual({ ok: true, body: {} });
  });
});
