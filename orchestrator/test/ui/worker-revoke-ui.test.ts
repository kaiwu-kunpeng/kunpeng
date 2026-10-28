import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { part10 } from "../../src/server/ui/client-parts/part10.js";
import { themeCss } from "../../src/server/ui/theme.js";
import { renderSettings } from "../../src/server/ui/views/settings.js";

const body = String(clientScript).replace(/^\s*<script>/, "").replace(/<\/script>\s*$/, "");

function extract(name: string): string {
  const at = clientScript.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`clientScript 里找不到内联的 ${name}`);
  let depth = 0;
  let started = false;
  for (let i = at; i < clientScript.length; i += 1) {
    const ch = clientScript[i];
    if (ch === "{") { depth += 1; started = true; }
    else if (ch === "}") { depth -= 1; if (started && depth === 0) return clientScript.slice(at, i + 1); }
  }
  throw new Error(`${name} 函数体括号不闭合`);
}

function loadWith(names: string[], target: string): (...args: unknown[]) => unknown {
  return new Function(`${names.map(extract).join("\n")}\nreturn ${target};`)() as (...args: unknown[]) => unknown;
}

const settingsHtml = renderSettings({ backend: {} } as never);

describe("拼装完整性", () => {
  test("clientScript 语法有效", () => {
    expect(() => new Function(body)).not.toThrow();
  });

  test("全脚本仍只有一个顶层 IIFE,part10 不自带包裹", () => {
    expect(clientScript.split("\n").filter((l) => l.trim() === "})();").length).toBe(1);
    expect(part10).not.toContain("(function");
    expect(part10.trimEnd().endsWith("})();")).toBe(false);
  });

  test("新函数已拼进脚本", () => {
    expect(body).toContain("kpWorkerRenderRevoked");
    expect(body).toContain("kpWorkerRevoke");
    expect(body).toContain("kpWorkerUnrevoke");
    expect(body).toContain("kpWorkerLoadRevoked");
  });
});

describe("机器行的吊销按钮", () => {
  const render = loadWith(["kpWorkerEscape", "kpWorkerRenderMachines"], "kpWorkerRenderMachines") as
    (p: unknown) => string;

  test("有 machineId 时渲染吊销按钮", () => {
    const html = render({ machines: [{ machineId: "a".repeat(32), machineName: "出差本", root: "/w" }] });
    expect(html).toContain('data-kp-worker-action="revoke"');
    expect(html).toContain('data-kp-machine="' + "a".repeat(32) + '"');
    expect(html).toContain("吊销");
  });

  test("machineId 为空时不渲染按钮", () => {
    const html = render({ machines: [{ machineName: "没有 id 的机器", root: "/w" }] });
    expect(html).not.toContain('data-kp-worker-action="revoke"');
  });

  test("原有字段仍然显示", () => {
    const html = render({ machines: [{ machineId: "b".repeat(32), machineName: "我的本", root: "/Users/me" }] });
    expect(html).toContain("我的本");
    expect(html).toContain("/Users/me");
  });

  test("恶意 machineName 的转义防线未被削弱", () => {
    const payload = '"><svg onload=alert(1)>';
    const html = render({ machines: [{ machineId: "c".repeat(32), machineName: payload, root: "正常" }] });
    expect(html).not.toContain(payload);
    expect(html).not.toContain("<svg");
    expect(html).toContain("&lt;svg");
  });

  test("恶意 root 同样被转义", () => {
    const payload = '"><img src=x onerror=alert(2)>';
    const html = render({ machines: [{ machineId: "d".repeat(32), machineName: "正常", root: payload }] });
    expect(html).not.toContain(payload);
    expect(html).not.toContain("<img");
  });

  test("空列表与非法 payload 的既有提示仍在", () => {
    expect(render({ machines: [] }).length).toBeGreaterThan(0);
    expect(() => render(null)).not.toThrow();
    expect(render(null)).not.toContain("undefined");
  });
});

describe("已吊销列表的渲染", () => {
  const render = loadWith(["kpWorkerEscape", "kpWorkerRenderRevoked"], "kpWorkerRenderRevoked") as
    (p: unknown) => string;

  test("有条目时列出 id 与解除按钮", () => {
    const html = render({ revoked: [{ machineId: "e".repeat(32), reason: "笔记本丢了" }] });
    expect(html).toContain("e".repeat(32));
    expect(html).toContain("笔记本丢了");
    expect(html).toContain('data-kp-worker-action="unrevoke"');
    expect(html).toContain("解除");
  });

  test("空数组给出提示", () => {
    const html = render({ revoked: [] });
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain("undefined");
  });

  test("非法 payload 不抛,给出不可用提示", () => {
    for (const bad of [null, undefined, "字符串", 42, {}, { revoked: "不是数组" }]) {
      expect(() => render(bad)).not.toThrow();
      expect(render(bad)).not.toContain("undefined");
    }
  });

  test("reason 也必须转义", () => {
    const payload = '"><svg onload=alert(3)>';
    const html = render({ revoked: [{ machineId: "f".repeat(32), reason: payload }] });
    expect(html).not.toContain(payload);
    expect(html).not.toContain("<svg");
  });

  test("machineId 也必须转义", () => {
    const html = render({ revoked: [{ machineId: '"><b>x</b>' }] });
    expect(html).not.toContain('"><b>x</b>');
  });
});

describe("设置页", () => {
  test("含已吊销容器", () => {
    expect(settingsHtml).toContain('id="kp-worker-revoked"');
  });

  test("异地工作机节的既有元素一个不少", () => {
    expect(settingsHtml).toContain('id="kp-worker-machines"');
    expect(settingsHtml).toContain('id="kp-worker-token"');
    expect(settingsHtml).toContain('id="kp-worker-cmd"');
    expect(settingsHtml).toContain('id="kp-worker-mint"');
    expect(settingsHtml).toContain("异地工作机");
  });

  test("原有五节一节不少", () => {
    for (const title of ["账号", "通讯", "后端路由", "运行状态", "偏好"]) {
      expect(settingsHtml, `${title} 不该消失`).toContain(title);
    }
  });

  test("页面本身不含任何 token 字面量", () => {
    expect(settingsHtml).not.toContain("w1.");
  });
});

describe("样式与既有接线", () => {
  test("两个新类进了 themeCss", () => {
    expect(themeCss).toContain("kp-worker-revoke");
    expect(themeCss).toContain("kp-worker-unrevoke");
  });

  test("themeCss 仍不含模式色字面量", () => {
    for (const color of ["#EA580C", "#2563EB", "#D97706"]) {
      expect(themeCss.toUpperCase()).not.toContain(color.toUpperCase());
    }
  });

  test("事件委托里现有三个 action 仍在", () => {
    for (const action of ["mint", "refresh", "copy-command"]) {
      expect(body, `${action} 分支不该消失`).toContain(`"${action}"`);
    }
  });

  test("新增两个 action 也在", () => {
    expect(body).toContain('"revoke"');
    expect(body).toContain('"unrevoke"');
  });
});