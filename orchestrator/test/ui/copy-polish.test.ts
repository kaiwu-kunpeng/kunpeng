import { clientSource } from "../helpers/client-source.js";
import { projectViewsSource } from "../helpers/project-views-source.js";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("状态词中文化与 emoji 清理", () => {
  it("今日任务行 stage 走 statusLabels 映射且键位补齐", () => {
    const client = clientSource();
    expect(client).toContain('"draft": "草稿"');
    expect(client).toContain('"needs-review": "待审"');
    const fnIdx = client.indexOf("function todayBucketHtml");
    const fn = client.slice(fnIdx, fnIdx + 2200);
    expect(fn).toContain("statusLabels[status]");
  });

  it("project/action-inbox 视图无 ✅⚠️🔄 emoji", () => {
    for (const [f, src] of [
      ["src/server/ui/views/" + "project.ts", projectViewsSource()],
      ["src/server/ui/views/action-inbox.ts", readFileSync("src/server/ui/views/action-inbox.ts", "utf8")],
    ]) {
      expect(src.includes("✅"), `${f} 含 ✅`).toBe(false);
      expect(src.includes("⚠️"), `${f} 含 ⚠️`).toBe(false);
      expect(src.includes("🔄"), `${f} 含 🔄`).toBe(false);
    }
  });

  it("替换后的文字徽标在场", () => {
    const project = projectViewsSource();
    expect(project).toContain("已选 ✓");
    expect(project).toContain("验证通过 ✓");
    const inbox = readFileSync("src/server/ui/views/action-inbox.ts", "utf8");
    expect(inbox).toContain("没有待你处理的事 ✓");
  });
});
