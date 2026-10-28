import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readJsonObjectStrict } from "../../src/server/read-body.js";
import { errorMessage, hasErrnoCode, isNodeError } from "../../src/util/errors.js";
import { escHtml } from "../../src/util/esc-html.js";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** 各 helper 唯一允许的定义位置（相对 src）。escapeHtml 一律用 util/esc-html 的 escHtml 别名导入，不许再定义。 */
const HOME: Record<string, readonly string[]> = {
  escapeHtml: [],
  isNodeError: ["util/errors.ts"],
  errorMessage: ["util/errors.ts"],
  isRecord: ["util/is-record.ts"],
  readJsonBody: ["server/read-body.ts"],
};

/** 本轮暂未收拢：该文件正被另一条在跑的流修改，合入后再收（2026-09-24）。 */
const PENDING: Record<string, readonly string[]> = {
  isNodeError: ["loop/ops-gate.ts"],
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** 顶层或缩进的函数声明、const/let/var 声明（含箭头函数赋值），不看调用与导入别名。 */
function declares(source: string, name: string): boolean {
  const fn = new RegExp(`^[ \\t]*(?:export[ \\t]+)?(?:default[ \\t]+)?(?:async[ \\t]+)?function\\*?[ \\t]+${name}\\b`, "m");
  const binding = new RegExp(`^[ \\t]*(?:export[ \\t]+)?(?:const|let|var)[ \\t]+${name}[ \\t]*[:=]`, "m");
  return fn.test(source) || binding.test(source);
}

describe("通用 helper 单一来源（作者锁定）", () => {
  const files = sourceFiles(SRC)
    .map((full) => relative(SRC, full).split("\\").join("/"))
    .filter((rel) => !rel.startsWith("server/ui/client-parts/"));

  it("扫描范围非空，且排除了浏览器端的 client-parts", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((rel) => rel.startsWith("server/ui/client-parts/"))).toBe(false);
  });

  it.each(Object.keys(HOME))("%s 只在允许的位置定义", (name) => {
    const definers = files.filter((rel) => declares(readFileSync(join(SRC, rel), "utf8"), name)).sort();
    const allowed = [...(HOME[name] ?? []), ...(PENDING[name] ?? [])].sort();
    expect(definers).toEqual(allowed);
  });

  it("声明识别覆盖 function / export async function / const 箭头函数", () => {
    expect(declares("function escapeHtml(v) {}", "escapeHtml")).toBe(true);
    expect(declares("export async function readJsonBody(req) {}", "readJsonBody")).toBe(true);
    expect(declares("  const isRecord = (v: unknown) => true;", "isRecord")).toBe(true);
    expect(declares("export const errorMessage: (e: unknown) => string = String;", "errorMessage")).toBe(true);
    expect(declares('import { escHtml as escapeHtml } from "./x.js";\nescapeHtml(1);', "escapeHtml")).toBe(false);
  });
});

describe("收拢后的 helper 行为（作者锁定）", () => {
  it("escHtml 转义五个字符并容忍 null", () => {
    expect(escHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(escHtml(null)).toBe("");
  });

  it("errorMessage / isNodeError / hasErrnoCode", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(42)).toBe("42");
    const enoent = Object.assign(new Error("missing"), { code: "ENOENT" });
    expect(isNodeError(enoent)).toBe(true);
    expect(isNodeError(new Error("plain"))).toBe(false);
    expect(isNodeError({ code: "ENOENT" })).toBe(false);
    expect(hasErrnoCode(enoent, "ENOENT")).toBe(true);
    expect(hasErrnoCode(enoent, "EACCES")).toBe(false);
  });

  it("readJsonObjectStrict：对象放行、非对象/坏 JSON/超限报错", async () => {
    const feed = (body: string) => { const req = new PassThrough(); queueMicrotask(() => req.end(body)); return req as never; };
    await expect(readJsonObjectStrict(feed('{"a":1}'))).resolves.toEqual({ a: 1 });
    await expect(readJsonObjectStrict(feed("[1]"))).rejects.toThrow("JSON 对象格式非法");
    await expect(readJsonObjectStrict(feed("{坏"))).rejects.toThrow();
    await expect(readJsonObjectStrict(feed(JSON.stringify({ big: "x".repeat(200) })), 50)).rejects.toThrow("请求体过大");
  });
});