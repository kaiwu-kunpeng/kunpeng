import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodegraphIndex } from "../../src/codegraph/index-cmd.js";

describe("A6 codegraph 增量 mtime-skip", () => {
  it("无变化时 skip,文件变化后重建", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-cgi-"));
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "a.ts"), "export function foo() { return 1; }\n");

    const r1 = await runCodegraphIndex(repo);
    expect(r1.skipped).toBe(false);
    const graphPath = join(repo, ".kunpeng", "codegraph", "graph.json");
    const mtime1 = statSync(graphPath).mtimeMs;

    // 再跑一次,无任何文件变化 → skip,graph.json 不被重写
    const r2 = await runCodegraphIndex(repo);
    expect(r2.skipped).toBe(true);
    expect(statSync(graphPath).mtimeMs).toBe(mtime1);

    // 新增一个源文件 → 文件集变化 → 必重建(避免依赖 mtime 毫秒精度)
    writeFileSync(join(repo, "src", "b.ts"), "export function bar() { return 3; }\n");
    const r3 = await runCodegraphIndex(repo);
    expect(r3.skipped).toBe(false);
  });
});