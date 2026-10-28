import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAndClose } from "../../src/product/loop-orchestrate.js";

describe("validate 收口自动沉淀知识", () => {
  let root: string;
  const slug = "demo";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kp-vk-"));
    const loopDir = join(root, ".kunpeng", "product", slug);
    mkdirSync(loopDir, { recursive: true });
    writeFileSync(join(loopDir, "state.json"), JSON.stringify({
      slug,
      currentStage: "validate",
      stages: {
        define: { status: "accepted" },
        spec: { status: "accepted" },
        design: { status: "accepted" },
        build: { status: "accepted" },
        validate: { status: "drafted" },
      },
    }));
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("recordAndClose 后 captures 目录出现产品验证条目", async () => {
    const out = await recordAndClose(root, slug, {
      pitch: { problem: "p", appetite: "小", solution: "s", rabbitHoles: [], noGos: [] },
      hypotheses: ["用户会每天用"],
      signals: [{ kind: "usage", note: "7日 2pv", at: 1 }],
      decision: "persevere",
      rationale: "信号正向",
    } as never, 1_000);
    expect(out).toBeTruthy();
    const capDir = join(root, ".kunpeng", "captures");
    const files = readdirSync(capDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const bodies = files.map((f) => readFileSync(join(capDir, f), "utf8")).join("\n");
    expect(bodies).toContain("产品验证");
    expect(bodies).toContain(slug);
    expect(bodies).toContain("persevere");
  });

  it("沉淀失败不影响主流程（captures 目录被文件占位也返回结果）", async () => {
    writeFileSync(join(root, ".kunpeng", "captures"), "not-a-dir");
    const out = await recordAndClose(root, slug, {
      pitch: { problem: "p", appetite: "小", solution: "s", rabbitHoles: [], noGos: [] },
      hypotheses: [],
      signals: [],
      decision: "pause",
      rationale: "",
    } as never, 1_000);
    expect(out).toBeTruthy();
  });
});