import { describe, it, expect } from "vitest";
import { stripMd, clip } from "../../src/server/ui/fmt.js";
import { httpSource } from "../helpers/http-source.js";

describe("清洗函数对知识卡片典型脏数据", () => {
  it("图片 markdown 标题清干净", () => {
    const t = clip(stripMd("![今日头条](https://lf-dw.toutiaostatic.com/obj/logo.png)![今日头条](https://x/2.png)"), 90);
    expect(t).not.toContain("![");
    expect(t).not.toContain("http");
  });
  it("# 前缀标题清干净", () => {
    expect(clip(stripMd("# 鲲鹏会话纪要 · 待办门三审"), 90)).toBe("鲲鹏会话纪要 · 待办门三审");
  });
});

describe("三个知识库端点出口接了清洗（源码级断言）", () => {
  it("http.ts 在 knowledge-resurface / knowledge-search / api-kb 响应路径引用 stripMd", () => {
    const src = httpSource();
    const resurfaceIdx = src.indexOf("knowledge-resurface");
    const searchIdx = src.indexOf("knowledge-search");
    const kbIdx = src.indexOf('"/api/kb"');
    expect(resurfaceIdx).toBeGreaterThan(-1);
    expect(searchIdx).toBeGreaterThan(-1);
    expect(kbIdx).toBeGreaterThan(-1);
    for (const [label, idx] of [["resurface", resurfaceIdx], ["search", searchIdx], ["kb", kbIdx]] as const) {
      const window = src.slice(idx as number, (idx as number) + 3000);
      expect(window.includes("stripMd"), `${label} 响应路径 3000 字符窗口内应引用 stripMd`).toBe(true);
    }
  });
});
