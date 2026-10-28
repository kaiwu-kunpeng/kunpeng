import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMethodologyBundle } from "../../src/compile/methodology-bundle.js";

describe("buildMethodologyBundle 脱底座方法论资产包", () => {
  // vitest 从 orchestrator/ 跑,上一层 = 鲲鹏仓根(含 constitution/ 与 skills/)
  const kunpengRoot = join(process.cwd(), "..");
  let out: string;
  let result: Awaited<ReturnType<typeof buildMethodologyBundle>>;

  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), "kp-bundle-"));
    result = await buildMethodologyBundle({ kunpengRoot, outDir: out });
  });
  afterAll(async () => {
    await rm(out, { recursive: true, force: true });
  });

  test("含宪法核心 + 约定", () => {
    expect(result.files).toContain("constitution-core.md");
    expect(result.files).toContain("constitution-conventions.md");
  });
  test("含 MANIFEST.md", () => {
    expect(result.files).toContain("MANIFEST.md");
  });
  test("至少携带一个 skill(skill-*.md)", () => {
    expect(result.files.some((f) => f.startsWith("skill-") && f.endsWith(".md"))).toBe(true);
  });
  test("宪法内容逐字携带(非空、与源一致)", async () => {
    const src = await readFile(join(kunpengRoot, "constitution/core.md"), "utf8");
    const copied = await readFile(join(out, "constitution-core.md"), "utf8");
    expect(copied).toBe(src);
    expect(copied.length).toBeGreaterThan(0);
  });
  test("产物真落盘(outDir 实际文件 = files 清单)", async () => {
    const onDisk = await readdir(out);
    expect(onDisk.sort()).toEqual([...result.files].sort());
  });
});