import { clientSource } from "./helpers/client-source.js";
import { httpSource } from "./helpers/http-source.js";
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const httpSrc = httpSource();
const clientSrc = clientSource();

describe("PDF 端侧抽取(作者验收)", () => {
  it("vendored pdfjs 在库且白名单两条齐", () => {
    for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
      expect(existsSync(join(root, "assets", "vendor", "pdfjs", f))).toBe(true);
      expect(httpSrc).toContain("pdfjs/" + f);
    }
  });
  it("client 走自托管 worker 且带可编辑预览与 .pdf.txt", () => {
    expect(clientSrc).toContain("/vendor/pdfjs/pdf.min.mjs");
    expect(clientSrc).toContain("/vendor/pdfjs/pdf.worker.min.mjs");
    expect(clientSrc).toContain("getTextContent");
    expect(clientSrc).toContain("pdf.txt");
  });
  it("扫描件回退与不出机话术", () => {
    expect(clientSrc.includes("未抽到文本") || clientSrc.includes("\\u672A\\u62BD\\u5230\\u6587\\u672C")).toBe(true);
    expect(clientSrc.includes("未离开本机") || clientSrc.includes("\\u672A\\u79BB\\u5F00\\u672C\\u673A")).toBe(true);
  });
});
