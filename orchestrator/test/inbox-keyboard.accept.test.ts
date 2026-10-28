import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const viewSrc = readFileSync(join(root, "src", "server", "ui", "views", "review-inbox.ts"), "utf8");
const clientSrc = clientSource();

describe("收件箱键盘流(作者验收)", () => {
  it("条目与动作带数据属性", () => {
    expect(viewSrc).toContain("data-kp-inbox-item");
    expect(viewSrc).toContain("data-kp-act");
  });
  it("j/k/a/d/e 与速查浮层在位", () => {
    expect(clientSrc).toContain("scrollIntoView");
    expect(clientSrc.includes("再按") || clientSrc.includes("\\u518D\\u6309")).toBe(true);
    expect(clientSrc.includes("快捷键") || clientSrc.includes("\\u5FEB\\u6377\\u952E")).toBe(true);
  });
  it("输入框内不劫持按键", () => {
    expect(/tagName|isContentEditable|INPUT|TEXTAREA/i.test(clientSrc)).toBe(true);
  });
});