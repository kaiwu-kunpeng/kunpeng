import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listOpsReports, aggregateOpsReports } from "../../src/server/state.js";
import { renderLoops } from "../../src/server/ui/views/loops.js";
import { httpSource } from "../helpers/http-source.js";

describe("调研档案 listOpsReports", () => {
  it("previews html + docs/reports md 汇总，目录缺失返回空", async () => {
    const root = await mkdtemp(join(tmpdir(), "ops-w2-"));
    expect(await listOpsReports(root)).toEqual([]);
    await mkdir(join(root, ".kunpeng", "previews"), { recursive: true });
    await mkdir(join(root, "docs", "reports"), { recursive: true });
    await writeFile(join(root, ".kunpeng", "previews", "a.html"), "<title>报告A</title><p>x</p>");
    await writeFile(join(root, "docs", "reports", "b.md"), "# 报告B\n\n正文\n");
    const reports = await listOpsReports(root);
    expect(reports).toHaveLength(2);
    const html = reports.find((r) => r.kind === "html");
    const md = reports.find((r) => r.kind === "md");
    expect(html?.file).toBe("a.html");
    expect(html?.title).toBe("报告A");
    expect(md?.file).toBe("b.md");
    expect(md?.title).toBe("报告B");
  });
});

describe("聚合与视图接线", () => {
  it("aggregateOpsReports 平铺合并并补 projectId", () => {
    const snaps = [
      { id: "kunpeng", name: "鲲鹏", state: { opsReports: [{ file: "a.html", kind: "html", title: "报告A", mtime: 1 }] } },
      { id: "acme-shop", name: "Acme", state: {} },
    ] as never;
    const out = aggregateOpsReports(snaps);
    expect(out).toHaveLength(1);
    expect(out[0].projectId).toBe("kunpeng");
  });

  it("http 聚合装配处接线（与 playbooks 同点）", () => {
    const src = httpSource();
    const idx = src.indexOf("aggregatePlaybooks(snaps)");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx - 1500, idx + 1500)).toContain("aggregateOpsReports(snaps)");
  });

  it("运营页渲染五段泳道、未分段列与调研档案链接", () => {
    const state = {
      loops: [],
      playbooks: [
        { id: "p1", title: "抓薄弱品类", phase: "research", sections: {}, body: "" },
        { id: "p2", title: "旧配方", sections: {}, body: "" },
      ],
      opsReports: [
        { file: "ops.html", kind: "html", title: "运营重设计", projectId: "kunpeng", mtime: 1 },
      ],
    } as never;
    const html = renderLoops(state);
    for (const key of ["research", "create", "distribute", "measure", "evolve"]) {
      expect(html).toContain(`data-phase="${key}"`);
    }
    expect(html).toContain('data-phase="unset"');
    expect(html).toContain("未分段");
    expect(html).toContain("调研档案");
    expect(html).toContain("/previews/kunpeng/ops.html");
  });
});
