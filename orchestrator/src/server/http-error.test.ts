import { describe, it, expect } from "vitest";
import { httpErrorView } from "./http.js";

describe("httpErrorView", () => {
  it("生产态返回固定文案,不泄露原始错误", () => {
    const v = httpErrorView(new Error("ENOENT /Users/secret/path/auth.json"), { debug: false });
    expect(v.message).toBe("内部错误");
    expect(v.message).not.toMatch(/secret|ENOENT|auth\.json/);
  });
  it("开发态保留原始错误细节便于排障", () => {
    const v = httpErrorView(new Error("boom-detail"), { debug: true });
    expect(v.message).toMatch(/boom-detail/);
  });
});