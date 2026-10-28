import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { part08 } from "../../src/server/ui/client-parts/part08.js";
import { part09 } from "../../src/server/ui/client-parts/part09.js";
import { themeCss } from "../../src/server/ui/theme.js";
import { renderShell } from "../../src/server/ui/shell.js";

const body = String(clientScript).replace(/^\s*<script>/, "").replace(/<\/script>\s*$/, "");

/** 用花括号配对从 clientScript 抠出内联函数,连同依赖一起 eval 成可调用的真函数。 */
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
  const src = names.map(extract).join("\n");
  return new Function(`${src}\nreturn ${target};`)() as (...args: unknown[]) => unknown;
}

const shellHtml = renderShell({ projects: [] } as never, { username: "小鹏" });

describe("拼装完整性", () => {
  test("clientScript 语法有效", () => {
    expect(() => new Function(body)).not.toThrow();
  });

  test("part09 已拼进最终脚本", () => {
    expect(body).toContain("kpModeApply");
    expect(body).toContain("kpModeInit");
    expect(body).toContain("kpModeAccount");
  });

  test("全脚本只有一个顶层 IIFE 收尾", () => {
    const closers = clientScript.split("\n").filter((line) => line.trim() === "})();");
    expect(closers.length).toBe(1);
  });

  test("part09 本体不自带闭包包裹", () => {
    expect(part09).not.toContain("(function");
    expect(part09.trimEnd().endsWith("})();")).toBe(false);
  });

  test("part09 位于唯一收尾之前 → 调得到 part08 的函数", () => {
    const at = clientScript.indexOf(part09.slice(0, 60));
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(clientScript.lastIndexOf("})();"));
  });

  test("part08 仍原样拼进(未被改写)", () => {
    expect(clientScript).toContain(part08);
  });
});

describe("顶栏渲染", () => {
  test("色带元素在", () => {
    expect(shellHtml).toContain('id="kp-mode-strip"');
  });

  test("三个模式选项都在", () => {
    expect(shellHtml).toContain('id="kp-mode-select"');
    expect(shellHtml).toContain('value="full"');
    expect(shellHtml).toContain('value="intranet"');
    expect(shellHtml).toContain('value="trip"');
    expect(shellHtml).toContain("满血模式");
    expect(shellHtml).toContain("内网模式");
    expect(shellHtml).toContain("出差模式");
  });

  test("账号写进 data-kp-account 且经过转义", () => {
    expect(shellHtml).toContain("data-kp-account=");
    const injected = renderShell({ projects: [] } as never, { username: '"><script>x</script>' });
    expect(injected).not.toContain('"><script>x</script>');
  });

  test("顶栏原有元素一个不少", () => {
    expect(shellHtml).toContain("kp-workspace-switcher");
    expect(shellHtml).toContain("kp-status-pill");
    expect(shellHtml).toContain("theme-toggle");
    expect(shellHtml).toContain('data-theme-set="light"');
    expect(shellHtml).toContain('data-theme-set="dark"');
  });
});

describe("样式", () => {
  test("四个新类都进了 themeCss(否则页面是裸的)", () => {
    for (const cls of [".kp-mode-strip", ".kp-mode", ".kp-mode-dot", ".kp-mode-select"]) {
      expect(themeCss, `${cls} 未进 themeCss`).toContain(cls);
    }
  });

  test("themeCss 里不得硬编码三个模式色(单一真源在 kpModeMeta)", () => {
    for (const color of ["#EA580C", "#2563EB", "#D97706"]) {
      expect(themeCss.toUpperCase()).not.toContain(color.toUpperCase());
    }
  });
});

describe("模式接线逻辑", () => {
  test("kpModeAccount:无元素时回落 default", () => {
    const fn = loadWith(["kpModeAccount"], "kpModeAccount");
    const g = globalThis as unknown as { document?: unknown };
    const saved = g.document;
    g.document = { querySelector: () => null, getElementById: () => null };
    try {
      expect(fn()).toBe("default");
    } finally {
      if (saved === undefined) delete g.document; else g.document = saved;
    }
  });

  test("kpModeApply:元素齐全时按 kpModeMeta 上色", () => {
    const fn = loadWith(["kpModeResolve", "kpModeMeta", "kpModeApply"], "kpModeApply");
    const strip = { style: { background: "" } };
    const dot = { style: { background: "" } };
    const select = { value: "", title: "" };
    const g = globalThis as unknown as { document?: unknown };
    const saved = g.document;
    g.document = {
      getElementById: (id: string) =>
        id === "kp-mode-strip" ? strip : id === "kp-mode-dot" ? dot : id === "kp-mode-select" ? select : null,
      querySelector: () => null,
    };
    try {
      fn("trip");
      expect(strip.style.background).toContain("repeating-linear-gradient");
      expect(dot.style.background).toBe("#D97706");
      expect(select.value).toBe("trip");
      fn("intranet");
      expect(strip.style.background).toBe("#2563EB");
      fn("bogus");
      expect(strip.style.background).toBe("#EA580C");
    } finally {
      if (saved === undefined) delete g.document; else g.document = saved;
    }
  });

  test("kpModeApply:元素缺失时不抛", () => {
    const fn = loadWith(["kpModeResolve", "kpModeMeta", "kpModeApply"], "kpModeApply");
    const g = globalThis as unknown as { document?: unknown };
    const saved = g.document;
    g.document = { getElementById: () => null, querySelector: () => null };
    try {
      expect(() => fn("trip")).not.toThrow();
      expect(() => fn(null)).not.toThrow();
      expect(() => fn(undefined)).not.toThrow();
    } finally {
      if (saved === undefined) delete g.document; else g.document = saved;
    }
  });

  test("色值单一真源:kpModeApply 用的正是 kpModeMeta 的返回", () => {
    const meta = loadWith(["kpModeResolve", "kpModeMeta"], "kpModeMeta") as
      (m: unknown) => { label: string; color: string; band?: string };
    const apply = loadWith(["kpModeResolve", "kpModeMeta", "kpModeApply"], "kpModeApply");
    const strip = { style: { background: "" } };
    const g = globalThis as unknown as { document?: unknown };
    const saved = g.document;
    g.document = {
      getElementById: (id: string) => (id === "kp-mode-strip" ? strip : null),
      querySelector: () => null,
    };
    try {
      for (const mode of ["full", "intranet", "trip"]) {
        apply(mode);
        expect(strip.style.background).toBe(meta(mode).band ?? meta(mode).color);
      }
    } finally {
      if (saved === undefined) delete g.document; else g.document = saved;
    }
  });
});