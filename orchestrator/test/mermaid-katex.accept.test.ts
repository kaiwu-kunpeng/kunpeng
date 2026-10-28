import { clientSource } from "./helpers/client-source.js";
import { httpSource } from "./helpers/http-source.js";
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const httpSrc = httpSource();
const clientSrc = clientSource();

describe("mermaid+KaTeX 渲染(作者验收)", () => {
  it("vendored 资产在库且白名单/前缀规则在位", () => {
    expect(existsSync(join(root, "assets", "vendor", "mermaid", "mermaid.min.js"))).toBe(true);
    expect(existsSync(join(root, "assets", "vendor", "katex", "katex.min.js"))).toBe(true);
    expect(existsSync(join(root, "assets", "vendor", "katex", "katex.min.css"))).toBe(true);
    expect(readdirSync(join(root, "assets", "vendor", "katex", "fonts")).filter((f) => f.endsWith(".woff2")).length).toBeGreaterThan(10);
    expect(httpSrc).toContain("mermaid/mermaid.min.js");
    expect(httpSrc).toContain("katex/fonts/");
    expect(httpSrc).toContain("font/woff2");
  });
  it("client 懒加载渲染且防重复防流式中跑", () => {
    expect(clientSrc).toContain("/vendor/mermaid/mermaid.min.js");
    expect(clientSrc).toContain("securityLevel");
    expect(clientSrc).toContain("/vendor/katex/katex.min.js");
    expect(clientSrc).toContain("throwOnError");
  });
  it("失败回退与源码切换话术", () => {
    expect(clientSrc.includes("图表语法错误") || clientSrc.includes("\\u56FE\\u8868\\u8BED\\u6CD5\\u9519\\u8BEF")).toBe(true);
    expect(clientSrc.includes("查看源码") || clientSrc.includes("\\u67E5\\u770B\\u6E90\\u7801")).toBe(true);
  });
});
