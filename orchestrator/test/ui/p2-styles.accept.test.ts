// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clientScript } from "../../src/server/ui/client.js";

const uiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "ui");
const themeSrc = readFileSync(join(uiDir, "theme.ts"), "utf8");
const panelSrc = readFileSync(join(uiDir, "workbench-panel.ts"), "utf8");
const shellSrc = readFileSync(join(uiDir, "shell.ts"), "utf8");

describe("P2 样式收尾(作者验收)", () => {
  test("SPA 语法守卫", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("审批卡与终端/toast token 落地在 theme", () => {
    expect(themeSrc).toContain(".kp-diff-card");
    expect(themeSrc).toContain("--term-bg");
    expect(themeSrc).toContain("--toast-bg");
  });

  test("死 CSS 已清:btn-primary 不再有单独 no-op 声明", () => {
    expect(themeSrc.includes(".btn-primary{border-radius:var(--r-sm)}")).toBe(false);
  });

  test("client 终端 tab 类化 + xterm 读 token + 回看提升 + toast 去硬编码", () => {
    expect(clientScript).toContain("kp-term-tab");
    expect(clientScript).toContain("--term-bg");
    expect(clientScript).toContain("scrollback: 5000");
    expect(clientScript.includes("rgba(20, 24, 33")).toBe(false);
  });

  test("无样式 chat 类补齐 + PWA 主题色换品牌", () => {
    expect(panelSrc).toContain(".kp-ctx-warning-note");
    expect(shellSrc.includes("#0C4A5E")).toBe(false);
  });
});