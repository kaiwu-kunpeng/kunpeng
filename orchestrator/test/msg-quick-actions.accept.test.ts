import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";

const src = clientSource();

describe("消息快捷操作(作者验收)", () => {
  it("划词浮条与两动作在位", () => {
    expect(src).toContain("kp-sel-actions");
    expect(src.includes("就这段追问") || src.includes("\\u5C31\\u8FD9\\u6BB5\\u8FFD\\u95EE")).toBe(true);
    expect(src).toContain("selectionchange");
  });
  it("引用回复与输入框选择豁免", () => {
    expect(src.includes("引用") || src.includes("\\u5F15\\u7528")).toBe(true);
    expect(/TEXTAREA|textarea/.test(src)).toBe(true);
  });
});
