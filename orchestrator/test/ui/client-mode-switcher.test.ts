import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { part07 } from "../../src/server/ui/client-parts/part07.js";
import { part08 } from "../../src/server/ui/client-parts/part08.js";

const body = String(clientScript).replace(/^\s*<script>/, "").replace(/<\/script>\s*$/, "");

/** 用花括号配对从 clientScript 抠出内联函数,独立 eval 成可调用的真函数。 */
function loadFn(name: string): (...args: unknown[]) => unknown {
  const at = clientScript.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`clientScript 里找不到内联的 ${name}`);
  let depth = 0;
  let started = false;
  let end = -1;
  for (let i = at; i < clientScript.length; i += 1) {
    const ch = clientScript[i];
    if (ch === "{") { depth += 1; started = true; }
    else if (ch === "}") { depth -= 1; if (started && depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error(`${name} 函数体括号不闭合`);
  const src = clientScript.slice(at, end);
  return new Function(`${src}; return ${name};`)() as (...args: unknown[]) => unknown;
}

describe("拼装:part07 原样,part08 不自带闭包", () => {
  test("client.ts 不再改写 part07(hack 已拆除)", () => {
    expect(clientScript).toContain(part07);
  });

  test("part08 本体不含 IIFE 开头", () => {
    expect(part08).not.toContain("(function");
  });

  test("part08 本体不以 })(); 结尾", () => {
    expect(part08.trimEnd().endsWith("})();")).toBe(false);
  });

  test("全脚本只有一个顶层 IIFE 收尾", () => {
    const closers = clientScript.split("\n").filter((line) => line.trim() === "})();");
    expect(closers.length).toBe(1);
  });

  test("脚本仍以 })(); 结尾(既有 client-split 断言的同一性质)", () => {
    expect(clientScript.trimEnd().endsWith("})();")).toBe(true);
  });

  test("part08 位于唯一收尾之前 → 与主 SPA 同作用域,函数调得到", () => {
    const at = clientScript.indexOf(part08.slice(0, 60));
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(clientScript.lastIndexOf("})();"));
  });
});

describe("三模式 · 客户端逻辑", () => {
  test("clientScript 语法有效(防 SPA 崩 / 转义陷阱)", () => {
    expect(() => new Function(body)).not.toThrow();
  });

  test("part08 已拼进最终脚本", () => {
    expect(body).toContain("kpModeResolve");
    expect(body).toContain("kpModeStorageKey");
    expect(body).toContain("kpModeMeta");
  });

  test("kpModeResolve:三个合法值原样返回", () => {
    const resolve = loadFn("kpModeResolve");
    expect(resolve("full")).toBe("full");
    expect(resolve("intranet")).toBe("intranet");
    expect(resolve("trip")).toBe("trip");
  });

  test("kpModeResolve:非法值一律回落 full,且不抛", () => {
    const resolve = loadFn("kpModeResolve");
    for (const bad of [null, undefined, "", "bogus", 0, 1, {}, []]) {
      expect(() => resolve(bad)).not.toThrow();
      expect(resolve(bad)).toBe("full");
    }
  });

  test("kpModeStorageKey:按账号分键", () => {
    const key = loadFn("kpModeStorageKey");
    expect(key("alice")).toBe("kp-mode:alice");
    expect(key("bob")).toBe("kp-mode:bob");
    expect(key("alice")).not.toBe(key("bob"));
  });

  test("kpModeStorageKey:空账号回落 default", () => {
    const key = loadFn("kpModeStorageKey");
    expect(key("")).toBe("kp-mode:default");
    expect(key(null)).toBe("kp-mode:default");
    expect(key(undefined)).toBe("kp-mode:default");
  });

  test("kpModeMeta:三档色值正确(顶栏色带靠它)", () => {
    const meta = loadFn("kpModeMeta") as (m: unknown) => { label: string; color: string };
    expect(meta("full").color).toBe("#EA580C");
    expect(meta("intranet").color).toBe("#2563EB");
    expect(meta("trip").color).toBe("#D97706");
  });

  test("kpModeMeta:三档标签可辨认", () => {
    const meta = loadFn("kpModeMeta") as (m: unknown) => { label: string; color: string };
    expect(meta("full").label).toContain("满血");
    expect(meta("intranet").label).toContain("内网");
    expect(meta("trip").label).toContain("出差");
  });

  test("kpModeMeta:非法值按 full 返回,不抛", () => {
    const meta = loadFn("kpModeMeta") as (m: unknown) => { label: string; color: string };
    expect(() => meta("bogus")).not.toThrow();
    expect(meta("bogus").color).toBe("#EA580C");
  });

  test("满血模式也有色带(不是无色默认)", () => {
    const meta = loadFn("kpModeMeta") as (m: unknown) => { label: string; color: string };
    expect(meta("full").color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  test("读写接线存在且带异常兜底", () => {
    expect(body).toContain("function kpModeRead");
    expect(body).toContain("function kpModeWrite");
    expect(body).toContain("localStorage");
    expect(body).toMatch(/kpModeRead[\s\S]{0,400}catch/);
    expect(body).toMatch(/kpModeWrite[\s\S]{0,400}catch/);
  });
});