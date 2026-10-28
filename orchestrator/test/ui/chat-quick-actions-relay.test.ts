// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { part03 } from "../../src/server/ui/client-parts/part03.js";
import { part04 } from "../../src/server/ui/client-parts/part04.js";
import { renderWorkbenchPanel } from "../../src/server/ui/workbench-panel.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

interface StubResponse {
  ok: boolean;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

let pickerCalls: number;

beforeEach(() => {
  pickerCalls = 0;
  document.documentElement.innerHTML = '<head></head><body><div id="view"></div></body>';
  window.location.hash = "#/workbench";
  vi.stubGlobal("WebSocket", class { close() {} addEventListener() {} send() {} } as unknown as typeof WebSocket);
  // 目录选择器:只记调用次数,返回永不落定的 promise —— 断言"点了会去要目录",不依赖 IndexedDB 等浏览器设施。
  vi.stubGlobal("showDirectoryPicker", vi.fn(() => { pickerCalls++; return new Promise<never>(() => {}); }));
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request): Promise<StubResponse> => {
    const url = String(input);
    if (url.startsWith("/api/view")) {
      return { ok: true, json: async () => ({ ok: true }), text: async () => renderWorkbenchPanel("") };
    }
    if (url === "/api/state") {
      return { ok: true, json: async () => ({ projects: [{ id: "current", name: "current" }] }), text: async () => "" };
    }
    if (url.startsWith("/api/conversations")) {
      return { ok: true, json: async () => ({ ok: true, conversations: [] }), text: async () => "" };
    }
    return { ok: true, json: async () => ({ ok: true }), text: async () => "" };
  }));
});

async function bootChatWindow(): Promise<Element> {
  new Function(clientScript)();
  for (let i = 0; i < 8; i++) await tick();
  const win = document.querySelector('.kp-win[data-kind="chat"]');
  expect(win, "工作台应自动开出一个 chat 窗口").not.toBeNull();
  return win!;
}

function quickButtons(win: Element): HTMLElement[] {
  return Array.from(win.querySelectorAll(".kp-quick-bar button")) as HTMLElement[];
}

function byLabel(win: Element, needle: string): HTMLElement {
  const hit = quickButtons(win).find((b) => (b.textContent ?? "").includes(needle));
  expect(hit, `快捷条里应有含「${needle}」的按钮`).toBeTruthy();
  return hit!;
}

test("快捷条 6 个按钮,契约分三类:授权动作 / 需目录模板 / 纯填词", async () => {
  const win = await bootChatWindow();
  const buttons = quickButtons(win);
  expect(buttons.length).toBe(6);

  const authorize = buttons.filter((b) => b.hasAttribute("data-kp-quick-authorize"));
  expect(authorize.length, "只有「授权本地目录」是纯动作按钮").toBe(1);
  expect(authorize[0].hasAttribute("data-kp-example"), "动作按钮不该再往输入框塞废话").toBe(false);

  const needsDir = buttons.filter((b) => b.hasAttribute("data-kp-needs-dir"));
  expect(needsDir.length, "读文件夹 / 生成文档两条依赖目录").toBe(2);
  for (const button of needsDir) {
    expect(button.getAttribute("data-kp-example") ?? "").toContain("{dir}");
  }

  const plain = buttons.filter((b) => !b.hasAttribute("data-kp-quick-authorize") && !b.hasAttribute("data-kp-needs-dir"));
  expect(plain.length).toBe(3);
  for (const button of plain) {
    expect(button.getAttribute("data-kp-example") ?? "").not.toContain("{dir}");
  }
});

test("纯填词的三个按钮,点了提示词直接落进输入框", async () => {
  const win = await bootChatWindow();
  const input = win.querySelector(".kp-win-input") as HTMLTextAreaElement;

  for (const [needle, expected] of [
    ["抓网页", "帮我研究下面这个主题，查证后给出带来源出处的结论："],
    ["/loop", "/loop "],
    ["/skills", "/skills"],
  ] as const) {
    input.value = "";
    byLabel(win, needle).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(input.value, `点「${needle}」应把提示词填进输入框`).toBe(expected);
  }
});

test("「授权本地目录」是真动作:点了直接要目录,而不是往输入框塞一句问句", async () => {
  const win = await bootChatWindow();
  const input = win.querySelector(".kp-win-input") as HTMLTextAreaElement;
  input.value = "";

  byLabel(win, "授权本地目录").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await tick();

  expect(pickerCalls, "应直接调起目录选择器").toBe(1);
  expect(input.value, "不该往输入框填任何东西").toBe("");
});

// 行为测试只能覆盖「浏览器支持目录选择器」这一条路径,另一条路径上加任何东西都测不到。
// 这里用源码级守卫堵住那个洞:不许出现第二处 showDirectoryPicker 判断,不许留旧提示词副本。
test("不许有降级分支:showDirectoryPicker 只在 localfsPick 里判一次", () => {
  // localfsPick 内合法地出现两次:一次特性探测 !window.showDirectoryPicker,一次真调用。
  // 特性探测只准有那一次——多出来的必然是新加的降级分支。
  expect(part04.split("!window.showDirectoryPicker").length - 1, "特性探测只准在 localfsPick 里出现一次").toBe(1);
  expect(part04, "不许靠按钮文案匹配来分流").not.toContain("indexOf(\"读文件夹\")");
});

test("提示词只有一处真源:旧的通用串必须清干净,新模板必须逐字在位", () => {
  for (const stale of [
    "请告诉我如何授权本地目录",
    "读取我授权的文件夹",
    "根据我给的材料生成一份文档",
  ]) {
    expect(part03, `旧提示词「${stale}」必须删干净,不许留注释副本`).not.toContain(stale);
    expect(part04, `旧提示词「${stale}」不许在 part04 里再复制一份`).not.toContain(stale);
  }
  expect(part03).toContain("读取已授权目录「{dir}」，梳理其中内容并生成一份可阅读的 HTML 汇报，写回该目录。");
  expect(part03).toContain("根据已授权目录「{dir}」里的材料生成一份文档（Word / PPT / Excel 任选一种），中文排版，写回该目录，交付前自检文件能正常打开且内容非空。");
  expect(part03).toContain("🔁 /loop 起开发循环");
  expect(part03).toContain("🧩 /skills 看能力");
});

test("未授权时点需目录的按钮:先要目录,且绝不把 {dir} 占位漏给用户", async () => {
  const win = await bootChatWindow();
  const input = win.querySelector(".kp-win-input") as HTMLTextAreaElement;

  for (const needle of ["读文件夹", "生成 Word"]) {
    pickerCalls = 0;
    input.value = "";
    byLabel(win, needle).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(pickerCalls, `未授权时点「${needle}」应先调起目录选择器`).toBe(1);
    expect(input.value, `未授权时点「${needle}」不该先把带占位的模板填进去`).not.toContain("{dir}");
  }
});