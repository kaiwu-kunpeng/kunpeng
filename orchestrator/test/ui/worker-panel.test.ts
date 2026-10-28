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

  test("全脚本仍只有一个顶层 IIFE", () => {
    expect(clientScript.split("\n").filter((line) => line.trim() === "})();").length).toBe(1);
  });

  test("part10 不自带闭包包裹,且位于收尾之前", () => {
    expect(part10).not.toContain("(function");
    expect(part10.trimEnd().endsWith("})();")).toBe(false);
    const at = clientScript.indexOf(part10.slice(0, 60));
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(clientScript.lastIndexOf("})();"));
  });

  test("part10 已拼进最终脚本", () => {
    expect(body).toContain("kpWorkerRenderMachines");
    expect(body).toContain("kpWorkerCommandLine");
    expect(body).toContain("kpWorkerInit");
  });
});

describe("转义:machineName 是工作机自报的,必须当不可信输入", () => {
  const escape = loadWith(["kpWorkerEscape"], "kpWorkerEscape") as (v: unknown) => string;
  const render = loadWith(["kpWorkerEscape", "kpWorkerRenderMachines"], "kpWorkerRenderMachines") as
    (p: unknown) => string;

  test("kpWorkerEscape 五个字符都转", () => {
    expect(escape("<")).not.toContain("<");
    expect(escape(">")).not.toContain(">");
    expect(escape('"')).not.toContain('"');
    expect(escape("'")).not.toContain("'");
    expect(escape("&")).toContain("&amp;");
  });

  test("& 先转,不产生二次转义", () => {
    expect(escape("&lt;")).toBe("&amp;lt;");
  });

  test("null / undefined 返回空串", () => {
    expect(escape(null)).toBe("");
    expect(escape(undefined)).toBe("");
  });

  test("恶意 machineName 不会以可执行形式出现在 HTML 里", () => {
    const html = render({
      machines: [{
        machineId: "abcdef0123456789abcdef0123456789",
        machineName: '<img src=x onerror="alert(1)">',
        root: "</code><script>alert(2)</script>",
        connectedAt: 1,
      }],
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('onerror="');
    expect(html).toContain("&lt;img");
  });

  test("恶意 root 同样被转义(判据:整串原样载荷不得出现 + 转义形式必须出现)", () => {
    const payload = '"><svg onload=alert(1)>';
    const html = render({
      machines: [{ machineId: "a".repeat(32), machineName: "正常", root: payload, connectedAt: 1 }],
    });
    expect(html).not.toContain(payload);
    expect(html).not.toContain("<svg");
    expect(html).toContain("&lt;svg");
  });
});

describe("列表渲染的三种状态", () => {
  const render = loadWith(["kpWorkerEscape", "kpWorkerRenderMachines"], "kpWorkerRenderMachines") as
    (p: unknown) => string;

  test("有机器时列出名字与目录", () => {
    const html = render({
      machines: [{ machineId: "0123456789abcdef0123456789abcdef", machineName: "出差本", root: "/Users/me/code", connectedAt: 1 }],
    });
    expect(html).toContain("出差本");
    expect(html).toContain("/Users/me/code");
    expect(html).toContain("01234567");
  });

  test("空数组给出「还没有工作机接入」类提示", () => {
    const html = render({ machines: [] });
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain("undefined");
  });

  test("非法 payload 不抛,给出读取失败提示", () => {
    for (const bad of [null, undefined, "字符串", 42, {}, { machines: "不是数组" }]) {
      expect(() => render(bad)).not.toThrow();
      expect(render(bad)).not.toContain("undefined");
    }
  });
});

describe("接入命令不带真 token", () => {
  const cmd = loadWith(["kpWorkerCommandLine"], "kpWorkerCommandLine") as (u: unknown) => string;

  test("命令里是占位符,不是真 token", () => {
    const line = cmd("wss://cockpit.aeohq.io/api/worker/connect");
    expect(line).toContain("KUNPENG_WORKER_TOKEN");
    expect(line).toContain("kunpeng worker");
    expect(line).toContain("wss://cockpit.aeohq.io/api/worker/connect");
    expect(line).not.toContain("w1.");
  });

  test("走环境变量而不是 --token(命令行会被 ps 看见)", () => {
    expect(cmd("wss://a/x")).not.toContain("--token");
  });
});

describe("WebSocket 地址推导", () => {
  const wsUrl = loadWith(["kpWorkerWsUrl"], "kpWorkerWsUrl") as (l: unknown) => string;

  test("https → wss,http → ws,保留端口", () => {
    expect(wsUrl({ protocol: "https:", host: "cockpit.aeohq.io" })).toBe("wss://cockpit.aeohq.io/api/worker/connect");
    expect(wsUrl({ protocol: "http:", host: "127.0.0.1:8911" })).toBe("ws://127.0.0.1:8911/api/worker/connect");
  });

  test("缺失 location 返回空串,不抛", () => {
    expect(() => wsUrl(null)).not.toThrow();
    expect(wsUrl(null)).toBe("");
    expect(wsUrl(undefined)).toBe("");
  });
});

describe("设置页", () => {
  test("新分节与三个容器都在", () => {
    expect(settingsHtml).toContain("异地工作机");
    expect(settingsHtml).toContain('id="kp-worker-machines"');
    expect(settingsHtml).toContain('id="kp-worker-token"');
    expect(settingsHtml).toContain('id="kp-worker-cmd"');
    expect(settingsHtml).toContain('id="kp-worker-mint"');
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

describe("样式", () => {
  test("新样式进了 themeCss", () => {
    expect(themeCss).toContain("kp-worker-machines");
  });

  test("themeCss 仍不含硬编码模式色", () => {
    for (const color of ["#EA580C", "#2563EB", "#D97706"]) {
      expect(themeCss.toUpperCase()).not.toContain(color.toUpperCase());
    }
  });
});