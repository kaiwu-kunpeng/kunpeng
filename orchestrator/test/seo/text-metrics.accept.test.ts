import { describe, expect, test } from "vitest";
import { countWords } from "../../src/seo/text-metrics.js";
import { checkFirstHtml } from "../../src/seo/gates/first-html.js";
import { auditPageHtml } from "../../src/seo/page-audit.js";

const ZH = "爱旭太阳能是全球领先的光伏组件制造商，专注于背接触电池技术的研发与量产。公司在广东、浙江、天津和山东设有生产基地，产品销往欧洲、澳洲、日本和东南亚等六十多个国家和地区。我们为住宅屋顶、工商业屋顶和大型地面电站提供高效组件，并提供完整的质保与售后服务。";
const JA = "当社は高効率の太陽電池モジュールを製造しており、住宅用と産業用の両方に対応した製品を提供しています。";
const TH = "บริษัทของเราเป็นผู้นำด้านพลังงานแสงอาทิตย์และผลิตแผงโซลาร์เซลล์ประสิทธิภาพสูงสำหรับบ้านและธุรกิจ";

const legacy = (t: string) => t.split(/\s+/).filter(Boolean).length;

describe("countWords（作者锁定）", () => {
  test("有空格的文字与旧算法逐字一致", () => {
    for (const t of [
      "Hello world, it is 2026 and we test.",
      "  leading and   trailing   spaces  ",
      "Солнечные панели высокой эффективности",
      "한국어 문장을 나눕니다 정말로",
      "one",
    ]) {
      expect(countWords(t)).toBe(legacy(t));
    }
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });

  test("中文段落按词计数：远多于空格切分，且不超过汉字数", () => {
    const han = [...ZH].filter((c) => /\p{Script=Han}/u.test(c)).length;
    expect(legacy(ZH)).toBe(1);
    const n = countWords(ZH);
    expect(n).toBeGreaterThanOrEqual(40);
    expect(n).toBeLessThanOrEqual(han);
  });

  test("日文、泰文也能切出多个词；标点不计入", () => {
    expect(legacy(JA)).toBe(1);
    expect(countWords(JA)).toBeGreaterThanOrEqual(10);
    expect(legacy(TH)).toBe(1);
    expect(countWords(TH)).toBeGreaterThanOrEqual(8);
    expect(countWords("。、，！？「」")).toBe(0);
  });

  test("中英混排：两部分相加", () => {
    const mixed = "AIKO 爱旭 ABC 背接触组件 solar panel";
    expect(countWords(mixed)).toBeGreaterThanOrEqual(6);
    expect(countWords(mixed)).toBeLessThanOrEqual(12);
  });
});

const zhPage = (body: string) =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>关于爱旭</title></head><body><main><h1>关于爱旭</h1><p>${body}</p></main></body></html>`;

describe("接线：首个 HTML 与页面审计（作者锁定）", () => {
  test("中文正文充足的服务端渲染页不再被判空壳", () => {
    const r = checkFirstHtml({ url: "https://demo.cn/cn/about", html: zhPage(ZH.repeat(4)), expectations: [] });
    expect(r.wordCount).toBeGreaterThanOrEqual(150);
    expect(r.shell).toBe(false);
    expect(r.findings.map((f) => f.rule)).not.toContain("first-html-shell");
  });

  test("中文正文很短的页仍然是空壳（门没有被放宽）", () => {
    const r = checkFirstHtml({ url: "https://demo.cn/cn/x", html: zhPage("欢迎访问我们的网站。"), expectations: [] });
    expect(r.shell).toBe(true);
    expect(r.findings.map((f) => f.rule)).toContain("first-html-shell");
  });

  test("页面审计的 wordCount 对中文页给出按词计数", () => {
    const a = auditPageHtml(zhPage(ZH), { url: "https://demo.cn/cn/about", httpCharset: "utf-8" });
    expect(a.wordCount).toBeGreaterThanOrEqual(40);
  });
});