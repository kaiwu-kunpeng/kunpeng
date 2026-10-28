import { describe, it, expect } from "vitest";
import { parseMetaTags, parseLinks, htmlToText, fetchRefScrape } from "../../src/product/fetch-ref.js";

const HTML = `<!doctype html><html><head>
<title>Linear</title>
<meta name="description" content="Build products">
<meta property="og:title" content="Linear OG">
<meta name="theme-color" content="#08090a">
<style>.x{color:red}</style></head>
<body><script>var a=1</script>
<a href="/pricing">Pricing</a><a href="https://x.com/linear">X</a><a href="/pricing">dup</a>
<h1>Linear</h1><p>The system</p></body></html>`;

describe("parseMetaTags", () => {
  it("取 title/description/og:title/theme-color", () => {
    const m = parseMetaTags(HTML);
    expect(m.title).toBe("Linear");
    expect(m.description).toBe("Build products");
    expect(m["og:title"]).toBe("Linear OG");
    expect(m["theme-color"]).toBe("#08090a");
  });
});

describe("parseLinks", () => {
  it("绝对化 href + 去重", () => {
    const links = parseLinks(HTML, "https://linear.app/");
    expect(links).toContain("https://linear.app/pricing");
    expect(links).toContain("https://x.com/linear");
    expect(links.filter((l) => l === "https://linear.app/pricing").length).toBe(1);
  });
});

describe("htmlToText", () => {
  it("去 script/style/标签", () => {
    const t = htmlToText(HTML);
    expect(t).toContain("The system");
    expect(t).not.toContain("var a=1");
    expect(t).not.toContain("color:red");
    expect(t).not.toContain("<h1>");
  });
});

describe("fetchRefScrape", () => {
  it("注入 fetch → 组装 RefScrape", async () => {
    const ref = await fetchRefScrape("https://linear.app/", { fetchText: async () => HTML });
    expect(ref.host).toBe("linear.app");
    expect(ref.metadata.title).toBe("Linear");
    expect(ref.links).toContain("https://linear.app/pricing");
    expect(ref.markdown).toContain("The system");
  });
});