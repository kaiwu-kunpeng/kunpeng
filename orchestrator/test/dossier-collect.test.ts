import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectDossierOverview } from "../src/server/dossier-state.js";

function fixture(): string {
  const repo = mkdtempSync(join(tmpdir(), "kp-dossier-"));
  writeFileSync(
    join(repo, "PROJECT.md"),
    "# x\n\n**北极星**：流占比\n**当期目标**：稳定\n\n**Now:** 干A\n**Next:** 干B\n**Later:** 干C\n",
  );
  writeFileSync(
    join(repo, "CHANGELOG.md"),
    "# Changelog\n\n## [Unreleased]\n\n### Added\n- 新X\n\n## [0.1.0] - 2026-06-14\n\n### Added\n- 老Y\n",
  );
  mkdirSync(join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(
    join(repo, "docs", "decisions", "0001-a.md"),
    "# ADR-0001: 决策甲\n\n- **Status**: Accepted\n- **Date**: 2026-06-20\n",
  );
  mkdirSync(join(repo, "docs", "specs"), { recursive: true });
  for (const n of ["a", "b", "c"]) {
    writeFileSync(join(repo, "docs", "specs", `2026-06-19-module-status-${n}.md`), `# m-${n}`);
  }
  mkdirSync(join(repo, ".kunpeng", "product"), { recursive: true });
  writeFileSync(
    join(repo, ".kunpeng", "product", "ost-tree.json"),
    JSON.stringify({ tree: { northStar: { outcome: "流转更稳", metric: "verified/day" } } }),
  );
  return repo;
}

describe("collectDossierOverview", () => {
  it("聚齐 project/changelog/adr/specFamilies/specTotal", async () => {
    const d = await collectDossierOverview(fixture());
    expect(d.project.northStar).toContain("流占比");
    expect(d.project.roadmap.now).toBe("干A");
    expect(d.changelog.total).toBe(1);
    expect(d.adrs[0].title).toBe("决策甲");
    expect(d.specTotal).toBe(3);
    expect(d.specFamilies.find((f) => f.family === "module")?.count).toBe(3);
    expect(d.ostNorthStar).toEqual({ outcome: "流转更稳", metric: "verified/day" });
  });

  it("空目录 best-effort 不抛、给空结构", async () => {
    const empty = mkdtempSync(join(tmpdir(), "kp-empty-"));
    const d = await collectDossierOverview(empty);
    expect(d.project.northStar).toBe("");
    expect(d.changelog.total).toBe(0);
    expect(d.adrs).toEqual([]);
    expect(d.specTotal).toBe(0);
    expect(d.ostNorthStar).toBeUndefined();
  });
});
