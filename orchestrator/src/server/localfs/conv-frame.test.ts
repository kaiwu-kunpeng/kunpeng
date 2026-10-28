import { describe, expect, test } from "vitest";
import { localFsConvFrame } from "./chat-wiring.js";

describe("localfs conv 帧", () => {
  test("含 convId 与可识别标记 class", () => {
    const f = localFsConvFrame("conv-abc123");
    expect(f).toContain("conv-abc123");
    expect(f).toContain("kp-localfs-conv");
    expect(f).toContain("data-conv");
  });

  test("对 convId 做 HTML 转义防注入", () => {
    const f = localFsConvFrame('a"<b>');
    expect(f).not.toContain('"<b>');
  });
});
