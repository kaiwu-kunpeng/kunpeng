import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { buildChatPrompt } from "../../src/server/workspace-endpoints.js";

const body = String(clientScript).replace(/^\s*<script>/, "").replace(/<\/script>\s*$/, "");

describe("localfs 写入回执透明化", () => {
  test("SPA 脚本语法有效(模板串转义未破坏)", () => {
    expect(() => new Function(body)).not.toThrow();
  });

  test("write/mkdir 回执带 根目录名/路径/字节数", () => {
    expect(body).toContain('"WROTE " + localfsDir.name + "/" + op.path');
    expect(body).toContain("op.content.length");
    expect(body).toContain('"MKDIR " + localfsDir.name + "/" + op.path');
  });

  test("同名嵌套目录告警 helper 存在且被 write/mkdir 两处调用", () => {
    expect(body).toContain("function localfsNestWarn");
    expect((body.match(/localfsNestWarn\(op\.path\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test("对话区活动行带根目录名前缀", () => {
    expect(body).toContain('localfsDir.name + "/" : "") + (op.path');
  });

  test("系统提示要求 agent 把 WROTE 落点原样告诉用户", () => {
    const prompt = buildChatPrompt([], "hi");
    expect(prompt).toContain("WROTE");
    expect(prompt).toContain("原样告诉用户");
  });

  test("既有守卫未被动过:持久化/防双开/贴底跟滚仍在", () => {
    expect(body).toContain("function localfsSaveHandle");
    expect(body).toContain("openingConvs");
    expect(body).toContain("function nearBottom");
  });
});