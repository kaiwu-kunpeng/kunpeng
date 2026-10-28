import { describe, expect, it } from "vitest";
import { classifyCliFailure, retryDelayMs } from "../src/agent/error-classify.js";

describe("CLI 失败分类(作者验收)", () => {
  it("瞬时错识别", () => {
    expect(classifyCliFailure(1, "Error: 429 rate limit exceeded").transient).toBe(true);
    expect(classifyCliFailure(1, "", "upstream 503 Service Unavailable").transient).toBe(true);
    expect(classifyCliFailure(1, "FetchError: socket hang up").transient).toBe(true);
    expect(classifyCliFailure(1, "ECONNRESET").transient).toBe(true);
    expect(classifyCliFailure(1, "API overloaded, please retry").transient).toBe(true);
  });
  it("不可重试识别且优先级高于瞬时模式", () => {
    expect(classifyCliFailure(1, "Not logged in").transient).toBe(false);
    expect(classifyCliFailure(1, "401 unauthorized").transient).toBe(false);
    expect(classifyCliFailure(1, "usage limit reached, retry after 429 window").transient).toBe(false);
    expect(classifyCliFailure(1, "error: unknown option '--bogus'").transient).toBe(false);
  });
  it("兜底:信号杀与未知都不重试", () => {
    expect(classifyCliFailure(null, "").transient).toBe(false);
    expect(classifyCliFailure(null, "").reason).toBe("killed");
    expect(classifyCliFailure(2, "some weird failure").transient).toBe(false);
  });
  it("退避序列 2s/8s/20s 封顶", () => {
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(2)).toBe(8000);
    expect(retryDelayMs(3)).toBe(20000);
    expect(retryDelayMs(7)).toBe(20000);
  });
});