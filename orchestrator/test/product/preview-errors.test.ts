import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPreviewErrors } from "../../src/product/preview-errors.js";
import { projectViewsSource } from "../helpers/project-views-source.js";

describe("readPreviewErrors", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-perr-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function writeLog(slug: string, text: string) {
    const dir = join(root, ".kunpeng", "product", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "preview.log"), text);
  }

  it("抽报错行、去重、取最后 N 条", async () => {
    writeLog("demo", [
      "ready in 300ms",
      "Error: Cannot find module 'left-pad'",
      "compiled successfully",
      "Error: Cannot find module 'left-pad'",
      "Build failed with 1 error",
    ].join("\n"));
    const errs = await readPreviewErrors(root, "demo");
    expect(errs.length).toBe(2);
    expect(errs.some((l) => l.includes("left-pad"))).toBe(true);
    expect(errs.some((l) => l.includes("Build failed"))).toBe(true);
  });

  it("无日志/无报错返回空；单条裁到 200 字符", async () => {
    expect(await readPreviewErrors(root, "none")).toEqual([]);
    writeLog("clean", "ready in 1ms\nserving http://localhost:3000\n");
    expect(await readPreviewErrors(root, "clean")).toEqual([]);
    writeLog("long", `Error: ${"x".repeat(500)}\n`);
    const [line] = await readPreviewErrors(root, "long");
    expect(line.length).toBeLessThanOrEqual(200);
  });

  it("源级：previewErrors 已接进 loadLoopView 与产品页", () => {
    expect(readFileSync("src/product/loop-orchestrate.ts", "utf8")).toContain("previewErrors");
    expect(projectViewsSource()).toContain("preview-errors");
  });
});
