import { describe, it, expect } from "vitest";
import { detectLoginFailure, isGarbageSpec } from "../../src/agent/login-preflight.js";

describe("detectLoginFailure", () => {
  it("识别 claude CLI 未登录输出", () => {
    expect(detectLoginFailure("Not logged in. Please run /login")).toBe(true);
    expect(detectLoginFailure("Error: not logged in")).toBe(true);
  });
  it("识别认证失败类输出", () => {
    expect(detectLoginFailure("401 Unauthorized")).toBe(true);
    expect(detectLoginFailure("authentication failed")).toBe(true);
    expect(detectLoginFailure("invalid credentials")).toBe(true);
  });
  it("正常输出不误报", () => {
    expect(detectLoginFailure("# spec\n实现登录页面的表单校验")).toBe(false);
    expect(detectLoginFailure("")).toBe(false);
  });
});

describe("isGarbageSpec", () => {
  it("空 spec 是垃圾", () => {
    expect(isGarbageSpec("")).toBe(true);
    expect(isGarbageSpec("   \n  ")).toBe(true);
  });
  it("短文本且命中登录失败特征是垃圾", () => {
    expect(isGarbageSpec("Not logged in. Please run /login.")).toBe(true);
  });
  it("长的正常 spec 即使提到特征字样也不误杀", () => {
    const long = "# 验收标准\n本模块用于检测 Not logged in 输出。\n" + "细节说明。".repeat(150);
    expect(isGarbageSpec(long)).toBe(false);
  });
});