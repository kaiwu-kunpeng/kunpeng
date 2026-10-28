import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDossierIfPresent, renderAutoBlock } from "../src/dossier/dossier.js";

const input = (n: number) => ({
  projectName: "demo",
  flows: Array.from({ length: n }, (_, i) => ({ flowId: `f${i}`, status: "verified", stage: "done", updatedAt: i })),
  now: 1,
});

describe("refreshDossierIfPresent", () => {
  it("无 PROJECT.md → 返回 false 且不新建", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-dref-"));
    const ok = await refreshDossierIfPresent(repo, input(3));
    expect(ok).toBe(false);
    expect(existsSync(join(repo, "PROJECT.md"))).toBe(false);
  });
  it("已有 PROJECT.md → 刷新机器区、保留人写区、返回 true", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-dref-"));
    const human = "# demo\n\n## 北极星\n\n月活破百万\n\n";
    writeFileSync(join(repo, "PROJECT.md"), human + renderAutoBlock(input(0)), "utf8");
    const ok = await refreshDossierIfPresent(repo, input(5));
    expect(ok).toBe(true);
    const out = readFileSync(join(repo, "PROJECT.md"), "utf8");
    expect(out).toContain("月活破百万");     // 人写区保留
    expect(out).toContain("累计流: **5**");   // 机器区刷新
    expect(out).not.toContain("累计流: **0**");
  });
});
