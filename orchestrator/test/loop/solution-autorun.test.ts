import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectAutoRunLoops } from "../../src/loop/solution-template.js";

describe("selectAutoRunLoops", () => {
  it("只选 autonomous===true 且 id 合法的;坏 JSON 跳过", () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-autorun-"));
    const dir = join(repo, ".kunpeng", "loops");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "l1.json"), JSON.stringify({ id: "l1", autonomous: true }), "utf8");
    writeFileSync(join(dir, "l2.json"), JSON.stringify({ id: "l2", autonomous: false }), "utf8");
    writeFileSync(join(dir, "l3.json"), JSON.stringify({ id: "l3" }), "utf8");
    writeFileSync(join(dir, "l4.json"), "不是JSON{", "utf8");
    writeFileSync(join(dir, "l5.json"), JSON.stringify({ autonomous: true }), "utf8");
    const out = selectAutoRunLoops(repo, ["l1.json", "l2.json", "l3.json", "l4.json", "l5.json", "缺失.json"]);
    expect(out).toEqual(["l1"]);
  });

  it("空清单安全", () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-autorun-empty-"));
    expect(selectAutoRunLoops(repo, [])).toEqual([]);
  });
});