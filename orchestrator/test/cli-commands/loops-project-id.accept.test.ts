import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/cli-commands/ops.js";
import { renderLoopsLines } from "../../src/cli-commands/ops.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { loopStore } from "../../src/cli-commands/shared.js";
import type { LoopDef } from "../../src/loop/types.js";

// 背景（2026-10-03 运营审计 A3 G6，总报告 P2-8 前半）：`kunpeng loops` 只打 loop id，多租户串仓（别的项目的 loop 混进本仓
// .kunpeng/loops）时肉眼看不出归属。本测试锁定：首列 projectId、有表头、空时提示；真仓目录里两条不同项目的 loop 都带各自 projectId。

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function loopDef(id: string, projectId: string, current: number, lever?: string): LoopDef {
  return {
    id, name: id, projectId, recipe: "geo-monitor",
    metric: { key: "mentions", label: "提及", current },
    levers: [], waves: [], createdAt: 1, updatedAt: 1,
    ...(lever === undefined ? {} : { nextLever: { lever } }),
  };
}

describe("kunpeng loops 显示 projectId（作者锁定）", () => {
  it("renderLoopsLines：表头 + 每行首列 projectId；空列表给提示", () => {
    expect(renderLoopsLines([])).toEqual(["(无 loop)"]);
    const lines = renderLoopsLines([loopDef("demo-geo", "demo-a", 3, "内链"), loopDef("demo-crawl", "demo-b", 0)]);
    expect(lines[0]).toBe("项目 ｜ loop ｜ 指标 ｜ 波次 ｜ 下一杠杆");
    expect(lines.slice(1)).toEqual([
      "demo-a ｜ demo-geo ｜ 3 ｜ 0 ｜ 内链",
      "demo-b ｜ demo-crawl ｜ 0 ｜ 0 ｜ -",
    ]);
  });

  it("真仓目录：两条不同项目的 loop 各带自己的 projectId，表头在首行", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-loops-pid-")); dirs.push(repo);
    const store = loopStore(repo);
    await store.create(loopDef("demo-geo", "demo-a", 3, "内链"));
    await store.create(loopDef("demo-crawl", "demo-b", 0));
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { out.push(line); });
    const command = listCliCommands().find((c) => c.name === "loops")!;
    await command.run({ repoRoot: repo, kunpengHome: repo, rest: [], argv: ["loops"], flags: new Set() });
    expect(out[0]).toBe("项目 ｜ loop ｜ 指标 ｜ 波次 ｜ 下一杠杆");
    expect(out.slice(1).sort()).toEqual([
      "demo-a ｜ demo-geo ｜ 3 ｜ 0 ｜ 内链",
      "demo-b ｜ demo-crawl ｜ 0 ｜ 0 ｜ -",
    ]);
  });
});