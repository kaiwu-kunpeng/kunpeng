import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendPick, readRecentPicks, kpBeaconSnippet } from "../../src/product/ops-kit.js";

describe("picks 落盘", () => {
  let root: string;
  const slug = "demo";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kp-pick-"));
    mkdirSync(join(root, ".kunpeng", "product", slug), { recursive: true });
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("append→read 回环：新的在前、limit 生效、裁剪生效", async () => {
    expect(await appendPick(root, slug, { selector: "#a", text: "первый" }, 1)).toBe(true);
    expect(await appendPick(root, slug, { selector: ".b>span", text: "x".repeat(500) }, 2)).toBe(true);
    expect(await appendPick(root, slug, { selector: "s".repeat(500) }, 3)).toBe(true);
    const picks = await readRecentPicks(root, slug, 2);
    expect(picks.length).toBe(2);
    expect(picks[0].at).toBe(3);
    expect(picks[0].selector.length).toBeLessThanOrEqual(200);
    expect(picks[1].text?.length).toBeLessThanOrEqual(120);
  });

  it("fail-safe：产品目录不存在/空 selector 拒收；缺文件读空", async () => {
    expect(await appendPick(root, "ghost", { selector: "#a" }, 1)).toBe(false);
    expect(await appendPick(root, slug, { selector: "" }, 1)).toBe(false);
    expect(await readRecentPicks(root, "ghost")).toEqual([]);
  });
});

describe("kpBeaconSnippet 拾取段", () => {
  it("包含拾取模式开关与 pick 上报", () => {
    const snippet = kpBeaconSnippet("demo", "http://localhost:7788", "test-token");
    expect(snippet).toContain("kp-pick");
    expect(snippet).toContain("pick");
    expect(snippet).toContain("Escape");
  });
});
