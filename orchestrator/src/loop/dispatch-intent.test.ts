import { describe, expect, test } from "vitest";
import { DISPATCH_UNTRUSTED_SOURCE, parseDispatchEvent } from "./dispatch-intent.js";
import { wrapUntrusted } from "../security/prompt-shield.js";

// 2026-10-04 P1-4：外部触发体一律包成不可信数据，requirement 从此是 wrapUntrusted 后的文本。
const wrapped = (raw: string): string => wrapUntrusted(DISPATCH_UNTRUSTED_SOURCE, raw);

describe("parseDispatchEvent", () => {
  test("triggered by label → intent", () => {
    expect(parseDispatchEvent({ label: "kunpeng:dispatch", title: "修复登录", body: "细节", number: 42 }))
      .toEqual({ requirement: wrapped("修复登录\n\n细节"), branch: "kp/dispatch-42" });
  });
  test("triggered by body marker → intent", () => {
    expect(parseDispatchEvent({ title: "加搜索", body: "/kunpeng 做个搜索框", number: 7 }))
      .toEqual({ requirement: wrapped("加搜索\n\n/kunpeng 做个搜索框"), branch: "kp/dispatch-7" });
  });
  test("no number → dispatch-0", () => {
    expect(parseDispatchEvent({ label: "kunpeng:dispatch", title: "x" }))
      .toEqual({ requirement: wrapped("x"), branch: "kp/dispatch-0" });
  });
  test("not triggered → null", () => {
    expect(parseDispatchEvent({ label: "bug", title: "x", body: "y" })).toBeNull();
  });
  test("triggered but empty requirement → null", () => {
    expect(parseDispatchEvent({ label: "kunpeng:dispatch", title: "   ", body: "" })).toBeNull();
  });
});
