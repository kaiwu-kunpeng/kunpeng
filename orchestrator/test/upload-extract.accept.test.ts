import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { officeKind, stripXmlText, extractOfficeText, extractToSidecar } from "../src/server/upload-extract.js";

function makeZip(dir: string, out: string, entries: Record<string, string>): string {
  for (const [rel, content] of Object.entries(entries)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  execFileSync("zip", ["-qr", out, ...Object.keys(entries).map((e) => e.split("/")[0])], { cwd: dir });
  return join(dir, out);
}

describe("office 预提取(作者验收)", () => {
  it("officeKind 与 stripXmlText", () => {
    expect(officeKind("A报告.PPTX")).toBe("pptx");
    expect(officeKind("b.xlsx")).toBe("xlsx");
    expect(officeKind("c.pdf")).toBeNull();
    expect(stripXmlText("<w:t>你好 &amp; 世界</w:t>")).toContain("你好 & 世界");
  });

  it("docx 提取段落文本", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-docx-"));
    const f = makeZip(dir, "t.docx", {
      "word/document.xml": '<w:document><w:p><w:r><w:t>第一段内容</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:document>',
    });
    const r = await extractOfficeText(f, "docx");
    expect(r.text).toContain("第一段内容");
    expect(r.text).toContain("第二段");
    expect(r.truncated).toBe(false);
  });

  it("xlsx 共享字符串+数值单元", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-xlsx-"));
    const f = makeZip(dir, "t.xlsx", {
      "xl/sharedStrings.xml": '<sst><si><t>品名</t></si><si><t>苹果</t></si></sst>',
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>',
    });
    const r = await extractOfficeText(f, "xlsx");
    expect(r.text).toContain("品名");
    expect(r.text).toContain("苹果");
    expect(r.text).toContain("42");
  });

  it("pptx 按页提取;损坏文件 sidecar 返回 null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-pptx-"));
    const f = makeZip(dir, "t.pptx", {
      "ppt/slides/slide1.xml": '<p:sld><a:t>封面标题</a:t></p:sld>',
      "ppt/slides/slide2.xml": '<p:sld><a:t>第二页要点</a:t></p:sld>',
    });
    const r = await extractOfficeText(f, "pptx");
    expect(r.text).toContain("封面标题");
    expect(r.text).toContain("【第1页】");
    expect(r.text.indexOf("封面标题")).toBeLessThan(r.text.indexOf("第二页要点"));
    const bad = join(dir, "bad.docx");
    writeFileSync(bad, "not a zip");
    expect(await extractToSidecar(bad, "bad.docx")).toBeNull();
    const side = await extractToSidecar(f, "t.pptx");
    expect(side).toBe(f + ".extracted.txt");
  });
});