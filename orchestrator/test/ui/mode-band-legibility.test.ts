import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { themeCss } from "../../src/server/ui/theme.js";
import { usageText, SELF_HELP_COMMANDS } from "../../src/cli.js";
import "../../src/cli-commands/worker.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";

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

const meta = loadWith(["kpModeResolve", "kpModeMeta"], "kpModeMeta") as
  (m: unknown) => { label: string; color: string; band: string };

describe("命令可发现性", () => {
  test("usageText 含 worker", () => {
    expect(usageText()).toContain("worker");
  });

  test("既有命令名一个不少", () => {
    const mustKeep = ["run", "plan", "merge", "serve", "loop", "autopilot", "spec-lint", "mcp", "plugin", "status"];
    for (const name of mustKeep) {
      expect(usageText(), `${name} 不该消失`).toContain(name);
    }
  });

  test("worker 命令确实注册着", () => {
    expect(listCliCommands().map((c) => c.name)).toContain("worker");
  });

  test("SELF_HELP_COMMANDS 已导出且含 worker", () => {
    expect(SELF_HELP_COMMANDS.has("worker")).toBe(true);
  });

  test("SELF_HELP_COMMANDS 不该误伤别的命令", () => {
    for (const name of ["run", "plan", "serve", "merge"]) {
      expect(SELF_HELP_COMMANDS.has(name), `${name} 不该自己接管 --help`).toBe(false);
    }
  });
});

describe("出差模式色带靠形状可辨", () => {
  test("trip 的 band 是条纹", () => {
    expect(meta("trip").band).toContain("repeating-linear-gradient");
  });

  test("full 与 intranet 的 band 是纯色,等于各自的 color", () => {
    expect(meta("full").band).toBe(meta("full").color);
    expect(meta("intranet").band).toBe(meta("intranet").color);
  });

  test("三档的 label 与 color 与改动前一致(不许顺手改配色)", () => {
    expect(meta("full").color).toBe("#EA580C");
    expect(meta("intranet").color).toBe("#2563EB");
    expect(meta("trip").color).toBe("#D97706");
    expect(meta("full").label).toContain("满血");
    expect(meta("intranet").label).toContain("内网");
    expect(meta("trip").label).toContain("出差");
  });

  test("非法值仍按 full,且 band 也回落", () => {
    expect(meta("bogus").color).toBe("#EA580C");
    expect(meta("bogus").band).toBe("#EA580C");
    expect(() => meta(null)).not.toThrow();
  });

  test("kpModeApply:色带用 band,圆点用 color", () => {
    const apply = loadWith(["kpModeResolve", "kpModeMeta", "kpModeApply"], "kpModeApply");
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
      apply("trip");
      expect(strip.style.background).toContain("repeating-linear-gradient");
      expect(dot.style.background).toBe("#D97706");
      apply("full");
      expect(strip.style.background).toBe("#EA580C");
      expect(dot.style.background).toBe("#EA580C");
    } finally {
      if (saved === undefined) delete g.document; else g.document = saved;
    }
  });
});

describe("样式与拼装未被破坏", () => {
  test("色带高度提到 6px", () => {
    const rule = themeCss.slice(themeCss.indexOf(".kp-mode-strip"));
    expect(rule.slice(0, 200)).toContain("6px");
  });

  test("themeCss 仍不含任何模式色字面量", () => {
    for (const color of ["#EA580C", "#2563EB", "#D97706", "#7C2D12"]) {
      expect(themeCss.toUpperCase()).not.toContain(color.toUpperCase());
    }
  });

  test("clientScript 语法有效", () => {
    expect(() => new Function(body)).not.toThrow();
  });

  test("全脚本仍只有一个顶层 IIFE", () => {
    expect(clientScript.split("\n").filter((line) => line.trim() === "})();").length).toBe(1);
  });
});