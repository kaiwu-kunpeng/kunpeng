import { afterEach, describe, expect, it } from "vitest";

import { pushWithTimeout } from "../src/runtime/merge-gate.js";

describe("merge-gate push 墙钟超时", () => {
  afterEach(() => {
    delete process.env.KUNPENG_MERGE_PUSH_TIMEOUT_MS;
  });

  it("push 正常完成时透传结果", async () => {
    await expect(pushWithTimeout(async () => "ok", 1000)).resolves.toBe("ok");
  });

  it("push 自身异常时透传异常", async () => {
    await expect(
      pushWithTimeout(async () => {
        throw new Error("remote rejected");
      }, 1000),
    ).rejects.toThrow(/remote rejected/);
  });

  it("push 悬挂超过 timeoutMs 时拒绝,报错含『push 超时』", async () => {
    await expect(pushWithTimeout(() => new Promise(() => {}), 50)).rejects.toThrow(/push 超时/);
  });

  it("未显式传参时读 KUNPENG_MERGE_PUSH_TIMEOUT_MS", async () => {
    process.env.KUNPENG_MERGE_PUSH_TIMEOUT_MS = "40";
    await expect(pushWithTimeout(() => new Promise(() => {}))).rejects.toThrow(/40/);
  });

  it("env 非法时回退默认且不影响快速完成的 push", async () => {
    process.env.KUNPENG_MERGE_PUSH_TIMEOUT_MS = "abc";
    await expect(pushWithTimeout(async () => 1)).resolves.toBe(1);
  });
});