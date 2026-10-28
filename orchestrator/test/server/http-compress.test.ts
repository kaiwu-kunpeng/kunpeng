import { describe, expect, test } from "vitest";
import { shouldGzip } from "../../src/server/http-compress.js";

const big = 4096;

describe("shouldGzip 协商判定", () => {
  test("accept gzip + text/html + 超阈值 → true", () => {
    expect(shouldGzip("gzip, deflate, br", "text/html; charset=utf-8", big)).toBe(true);
  });

  test("SSE(text/event-stream) 恒 false（即便 accept gzip 且很大）", () => {
    expect(shouldGzip("gzip", "text/event-stream; charset=utf-8", big)).toBe(false);
  });

  test("无 accept-encoding → false", () => {
    expect(shouldGzip(undefined, "text/html", big)).toBe(false);
  });

  test("accept 不含 gzip（只 deflate/br）→ false", () => {
    expect(shouldGzip("deflate, br", "text/html", big)).toBe(false);
  });

  test("小于阈值(1024) → false", () => {
    expect(shouldGzip("gzip", "text/html", 100)).toBe(false);
  });

  test("不可压类型(image/png) → false", () => {
    expect(shouldGzip("gzip", "image/png", big)).toBe(false);
  });

  test("application/json + gzip + 超阈值 → true", () => {
    expect(shouldGzip("gzip", "application/json", big)).toBe(true);
  });

  test("gzip 子串不被 'gzipx' 之类误判（需词边界）", () => {
    expect(shouldGzip("xgzipx", "text/html", big)).toBe(false);
  });
});