import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFlowsCached } from "../../src/server/state.js";

const NOW = 1_800_000_000_000;
let repo: string;

function writeFlow(id: string): void {
  const dir = join(repo, ".kunpeng", "state");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ flowId: id, requirement: id, stage: "done", status: "verified", updatedAt: NOW }));
}

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-flowcache-")); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe("listFlowsCached", () => {
  it("读得到流列表", async () => {
    writeFlow("f1");
    writeFlow("f2");
    const flows = await listFlowsCached(repo, NOW);
    expect(flows).toHaveLength(2);
  });
  it("TTL 内命中缓存：新写入的流在同一 TTL 窗口内不可见", async () => {
    writeFlow("f1");
    const first = await listFlowsCached(repo, NOW);
    expect(first).toHaveLength(1);
    writeFlow("f2");
    const second = await listFlowsCached(repo, NOW + 1000);
    expect(second).toHaveLength(1);
  });
  it("TTL 过期后重新读盘看见新流", async () => {
    writeFlow("f1");
    await listFlowsCached(repo, NOW);
    writeFlow("f2");
    const after = await listFlowsCached(repo, NOW + 10_000);
    expect(after).toHaveLength(2);
  });
  it("不同 repo 各自缓存互不影响", async () => {
    writeFlow("f1");
    const other = mkdtempSync(join(tmpdir(), "kp-flowcache2-"));
    try {
      const a = await listFlowsCached(repo, NOW);
      const b = await listFlowsCached(other, NOW);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(0);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
  it("空目录/不存在目录返回空数组不抛", async () => {
    const flows = await listFlowsCached(join(repo, "ghost"), NOW);
    expect(flows).toEqual([]);
  });
});
