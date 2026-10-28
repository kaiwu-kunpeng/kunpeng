import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withCockpit, withBrowserPage } from "../support/cockpit-e2e.js";
import { ConversationStore } from "../../src/chat/conversation-store.js";

// 真浏览器 e2e:默认跳过,accept 用 KP_E2E=1 触发。
// 锁定工作台左栏「历史会话」的端到端接线:无 auth 时服务端身份为 "local",
// 故预先在 {stateDir}/chat/local/ 播种会话,再开浏览器断言侧栏渲染/续聊/软删。
describe.runIf(process.env.KP_E2E === "1")("工作台历史会话左栏 真浏览器 e2e", () => {
  let stateDir: string;
  let withUrlId = "";
  let plainId = "";

  beforeAll(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "kp-convui-e2e-"));
    let k = 0;
    const store = new ConversationStore(join(stateDir, "chat"), {
      now: () => Date.now(),
      id: () => `conv-seed-${++k}`,
    });
    // 会话一:含联网/URL,用于「点开续聊读回完整上下文」断言。
    const a = await store.create("local", { model: "claude-opus-4-8" });
    withUrlId = a.id;
    await store.appendTurns("local", a.id, [
      { role: "user", text: "查一下东京樱花花期", web: true },
      { role: "assistant", text: "见 https://example.com/sakura 预测三月下旬开放", web: true },
    ]);
    // 会话二:纯闲聊,用于「悬停删除=软删归档」断言(不含 URL,避免触发 KB 抽取 LLM 路径)。
    const b = await store.create("local", { model: "claude-opus-4-8" });
    plainId = b.id;
    await store.appendTurns("local", b.id, [
      { role: "user", text: "随便聊聊天气" },
      { role: "assistant", text: "今天挺好的" },
    ]);
  });

  afterAll(async () => {
    if (stateDir) await rm(stateDir, { recursive: true, force: true });
  });

  it("侧栏渲染播种会话 + 点开续聊读回完整 turns + 删除软归档", async () => {
    await withCockpit(
      process.cwd(),
      async ({ baseUrl, stateDir: sd }) => {
        await withBrowserPage(baseUrl, "#/workbench", async (page) => {
          // 1) 左栏会话列表容器出现,且两条播种会话都渲染成项(class=kp-conv-item, 带 data-conv)。
          await page.waitForSelector("#kp-conv-list .kp-conv-item", { timeout: 15000 });
          const titles = await page.$$eval("#kp-conv-list .kp-conv-item", (els) =>
            els.map((e) => (e.textContent || "").trim()),
          );
          expect(titles.join(" | ")).toContain("查一下东京樱花花期");
          expect(titles.join(" | ")).toContain("随便聊聊天气");

          // 2) 点含 URL 那条 → 打开一个对话窗口,日志里读回完整历史(助手回复正文)。
          await page.click(`#kp-conv-list .kp-conv-item[data-conv="${withUrlId}"]`);
          await page.waitForFunction(
            () => {
              const logs = Array.from(document.querySelectorAll(".kp-win .kp-win-log"));
              return logs.some((l) => (l.textContent || "").includes("预测三月下旬开放"));
            },
            { timeout: 15000 },
          );

          // 3) 删除纯闲聊那条 → 该项从侧栏消失。
          const delSel = `#kp-conv-list .kp-conv-item[data-conv="${plainId}"] .kp-conv-del`;
          await page.waitForSelector(delSel, { timeout: 5000 });
          await page.click(delSel);
          await page.waitForFunction(
            (id) => !document.querySelector(`#kp-conv-list .kp-conv-item[data-conv="${id}"]`),
            plainId,
            { timeout: 10000 },
          );
        });

        // 4) 软删=底层文件仍在且 archived=true(从同一 stateDir 读)。
        const store = new ConversationStore(join(sd, "chat"), {
          now: () => Date.now(),
          id: () => "x",
        });
        const got = await store.get("local", plainId);
        expect(got?.archived).toBe(true);
      },
      { stateDir },
    );
  }, 90000);

  it("点『＋新对话』开一个新的空对话窗口", async () => {
    await withCockpit(
      process.cwd(),
      async ({ baseUrl }) => {
        await withBrowserPage(baseUrl, "#/workbench", async (page) => {
          await page.waitForSelector("#kp-new-chat", { timeout: 15000 });
          const before = (await page.$$(".kp-win")).length;
          await page.click("#kp-new-chat");
          await page.waitForFunction(
            (n) => document.querySelectorAll(".kp-win").length > n,
            before,
            { timeout: 10000 },
          );
        });
      },
      { stateDir },
    );
  }, 90000);
});
