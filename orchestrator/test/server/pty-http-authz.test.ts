import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { clampPtyDims, handlePtyHttpRoute } from "../../src/server/pty-endpoint.js";
import { PtySessionPool, type PtyHandle, type PtySpawnOpts } from "../../src/server/pty-pool.js";

function fakeFactory(): (o: PtySpawnOpts) => PtyHandle {
  return () => ({ write() {}, resize() {}, onData() {}, onExit() {}, kill() {} });
}

function fakeRes(): { res: ServerResponse; out: () => { status: number; body: string } } {
  let status = 0;
  let body = "";
  const res = {
    setHeader() {},
    end(p?: unknown) {
      body = String(p ?? "");
    },
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
  } as unknown as ServerResponse;
  return { res, out: () => ({ status, body }) };
}

describe("pty HTTP 会话管理加固", () => {
  it("clampPtyDims:默认/钳制/放行", () => {
    expect(clampPtyDims(undefined, undefined)).toEqual({ cols: 80, rows: 24 });
    expect(clampPtyDims(1e9, 1e9)).toEqual({ cols: 500, rows: 200 });
    expect(clampPtyDims(-5, 0)).toEqual({ cols: 80, rows: 24 });
    expect(clampPtyDims("abc", 1)).toEqual({ cols: 80, rows: 24 });
    expect(clampPtyDims(120, 40)).toEqual({ cols: 120, rows: 40 });
  });

  it("归属校验失败 → list 返回 403", async () => {
    const pool = new PtySessionPool({ factory: fakeFactory() });
    const { res, out } = fakeRes();
    const handled = await handlePtyHttpRoute("GET", "/api/workspace/w1/pty/sessions", {} as IncomingMessage, res, {
      pool,
      resolveCwd: async () => {
        throw new Error("未授权工作区");
      },
    });
    expect(handled).toBe(true);
    expect(out().status).toBe(403);
  });

  it("归属校验通过 → list 返回 200", async () => {
    const pool = new PtySessionPool({ factory: fakeFactory() });
    const { res, out } = fakeRes();
    await handlePtyHttpRoute("GET", "/api/workspace/w1/pty/sessions", {} as IncomingMessage, res, {
      pool,
      resolveCwd: async () => "/tmp",
    });
    expect(out().status).toBe(200);
  });

  it("归属校验失败 → kill 返回 403(不泄漏会话存在性)", async () => {
    const pool = new PtySessionPool({ factory: fakeFactory() });
    const { res, out } = fakeRes();
    await handlePtyHttpRoute("DELETE", "/api/workspace/w1/pty/sessions/s1", {} as IncomingMessage, res, {
      pool,
      resolveCwd: async () => {
        throw new Error("未授权工作区");
      },
    });
    expect(out().status).toBe(403);
  });
});