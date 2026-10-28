import { describe, expect, test } from "vitest";
import { Window } from "happy-dom";
import { renderSettings } from "../../src/server/ui/views/settings.js";

describe("通讯设置页密钥输入框（作者锁定）", () => {
  test("四个密钥输入框是 password 类型，非密钥字段仍是普通文本框，字段总数不变", () => {
    const window = new Window();
    window.document.body.innerHTML = renderSettings({} as never);
    const typeOf = (k: string) => window.document.querySelector(`[data-nf="${k}"]`)?.getAttribute("type") ?? "";
    for (const k of ["tgToken", "wxToken", "serverChan", "wecom"]) expect(typeOf(k)).toBe("password");
    for (const k of ["cockpitUrl", "tgChat", "wxUid"]) expect(typeOf(k)).not.toBe("password");
    expect(window.document.querySelectorAll("[data-nf]").length).toBe(7);
  });
});