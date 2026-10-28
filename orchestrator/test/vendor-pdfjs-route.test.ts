import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

import { readFileSync } from "node:fs";

import { clientScript } from "../src/server/ui/client.js";
import { resolveVendorPdfjsPath, vendorPdfjsContentType, vendorPdfjsRoot } from "../src/server/routes/vendor-pdfjs.js";

const require = createRequire(import.meta.url);

function routeSource(): string {
  return readFileSync(new URL("../src/server/routes/vendor-pdfjs.ts", import.meta.url), "utf8");
}

/** 取 localfs 读分支那段源码。 */
function readBranch(): string {
  const at = clientScript.indexOf('if (op.kind === "read")');
  if (at < 0) throw new Error("clientScript 里找不到 localfs read 分支");
  return clientScript.slice(at, at + 2500);
}

describe("pdfjs 依赖真的装上了", () => {
  test("package.json 声明 pdfjs-dist", () => {
    const pkg = require("../package.json") as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toContain("pdfjs-dist");
  });
});

describe("缺包也不能炸(上一轮回滚的直接原因)", () => {
  test("pdfjs-dist 的解析必须发生在 vendorPdfjsRoot 函数体内,不得在模块顶层", () => {
    const src = routeSource();
    const fnAt = src.indexOf("function vendorPdfjsRoot");
    const resolveAt = src.indexOf('resolve("pdfjs-dist');
    expect(fnAt).toBeGreaterThanOrEqual(0);
    expect(resolveAt).toBeGreaterThanOrEqual(0);
    expect(resolveAt).toBeGreaterThan(fnAt);
  });

  test("模块顶层不得静态 import pdfjs-dist", () => {
    expect(routeSource()).not.toMatch(/^\s*import[^\n]*["']pdfjs-dist/m);
  });

  test("vendorPdfjsRoot 可调用且不抛(装了返回路径,没装返回 null)", () => {
    let value: string | null = null;
    expect(() => { value = vendorPdfjsRoot(); }).not.toThrow();
    expect(value === null || typeof value === "string").toBe(true);
  });
});

describe("资源路由的路径解析", () => {
  test("三个允许前缀都放行", () => {
    expect(resolveVendorPdfjsPath("build/pdf.min.mjs")).toBe("build/pdf.min.mjs");
    expect(resolveVendorPdfjsPath("cmaps/UniGB-UCS2-H.bcmap")).toBe("cmaps/UniGB-UCS2-H.bcmap");
    expect(resolveVendorPdfjsPath("standard_fonts/FoxitSans.pfb")).toBe("standard_fonts/FoxitSans.pfb");
  });

  test("目录穿越一律拒绝", () => {
    expect(resolveVendorPdfjsPath("build/../../../etc/passwd")).toBeNull();
    expect(resolveVendorPdfjsPath("../package.json")).toBeNull();
    expect(resolveVendorPdfjsPath("cmaps/../../secret")).toBeNull();
  });

  test("前缀不在白名单内一律拒绝", () => {
    expect(resolveVendorPdfjsPath("package.json")).toBeNull();
    expect(resolveVendorPdfjsPath("lib/pdf.js")).toBeNull();
    expect(resolveVendorPdfjsPath("/build/pdf.min.mjs")).toBeNull();
    expect(resolveVendorPdfjsPath("")).toBeNull();
  });

  test("content-type 按扩展名给", () => {
    expect(vendorPdfjsContentType("build/pdf.min.mjs")).toContain("application/javascript");
    expect(vendorPdfjsContentType("cmaps/UniGB-UCS2-H.bcmap")).toBe("application/octet-stream");
    expect(vendorPdfjsContentType("standard_fonts/FoxitSans.pfb")).toBe("application/octet-stream");
  });
});

describe("客户端接线", () => {
  test("clientScript 语法有效(防 SPA 崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("read 分支接上了 PDF 抽取,且排在 5MB 上限判断之前", () => {
    const branch = readBranch();
    const pdfAt = branch.indexOf("kpPdfExtract");
    const limitAt = branch.indexOf("binaryReadLimit");
    expect(pdfAt).toBeGreaterThanOrEqual(0);
    expect(limitAt).toBeGreaterThanOrEqual(0);
    expect(pdfAt).toBeLessThan(limitAt);
  });

  test("Office 抽取仍排在 PDF 之前(既有行为不变)", () => {
    const branch = readBranch();
    expect(branch.indexOf("kpOfficeExtract")).toBeGreaterThanOrEqual(0);
    expect(branch.indexOf("kpOfficeExtract")).toBeLessThan(branch.indexOf("kpPdfExtract"));
  });

  test("中文 PDF 必需的 cmaps 与标准字体都配上了", () => {
    expect(clientScript).toContain("/api/vendor/pdfjs?f=cmaps/");
    expect(clientScript).toContain("cMapPacked");
    expect(clientScript).toContain("/api/vendor/pdfjs?f=standard_fonts/");
    expect(clientScript).toContain("/api/vendor/pdfjs?f=build/pdf.worker.min.mjs");
  });

  test("pdf.js 是懒加载,不在页面初始化时拉", () => {
    expect(clientScript).toContain('import("/api/vendor/pdfjs?f=build/pdf.min.mjs")');
    expect(clientScript).not.toContain('<script src="/api/vendor/pdfjs');
  });
});