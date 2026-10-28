import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDocsOverview } from "../../src/server/state.js";
import { renderDocs } from "../../src/server/ui/views/docs.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-docs-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("buildDocsOverview", () => {
  it("扫描 .html + 抽取 title + 按 mtime 降序", () => {
    writeFileSync(join(dir, "a.html"), "<html><head><title>文档甲</title></head><body>x</body></html>");
    // 让 b 比 a 新
    writeFileSync(join(dir, "b.html"), "<!doctype html><title>  文档乙  </title>x");
    // 强制 b 更新的 mtime（用 utimes 不方便，改为写入顺序足够：b 后写 mtime 更大）
    const out = buildDocsOverview(dir);
    expect(out.length).toBe(2);
    const titles = out.map((d) => d.title);
    expect(titles).toContain("文档甲");
    expect(titles).toContain("文档乙"); // 首尾空白已去
    expect(out.every((d) => typeof d.updatedAt === "number")).toBe(true);
    // 降序：第一个的 updatedAt >= 第二个
    expect(out[0].updatedAt).toBeGreaterThanOrEqual(out[1].updatedAt);
  });

  it("无 title 用文件名兜底；非 html 忽略；目录不存在返回 []", () => {
    writeFileSync(join(dir, "no-title.html"), "<html>没有标题</html>");
    writeFileSync(join(dir, "ignore.txt"), "不是 html");
    const out = buildDocsOverview(dir);
    expect(out.map((d) => d.name)).toEqual(["no-title.html"]);
    expect(out[0].title).toBe("no-title");
    expect(buildDocsOverview(join(dir, "不存在"))).toEqual([]);
  });
});

describe("renderDocs", () => {
  it("渲染文档卡:title + /doc?name= 链接", () => {
    const html = renderDocs({ docsCatalog: [{ name: "战略.html", title: "战略方案", updatedAt: 1 }] } as never);
    expect(html).toContain("战略方案");
    expect(html).toContain("/doc?name=");
    expect(html).toContain(encodeURIComponent("战略.html"));
  });
  it("空态提示放文档的目录", () => {
    const html = renderDocs({ docsCatalog: [] } as never);
    expect(html).toContain("kunpeng-strategy-docs");
  });
});
