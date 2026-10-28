import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtempSync, readFileSync as rf } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveNotifyConfig } from "../../src/runtime/notify.js";

function src(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

describe("状态文件原子写", () => {
  it("notify.ts 用 writeFileAtomic 写 notify.json", () => {
    const text = src("../../src/runtime/notify.ts");
    expect(text).toContain("writeFileAtomic");
    expect(/writeFile\(\s*join\(dir,\s*"notify\.json"/.test(text)).toBe(false);
  });

  it("loop-checkpoint.ts 用 writeFileAtomic 写 meta.json", () => {
    const text = src("../../src/product/loop-checkpoint.ts");
    expect(text).toContain("writeFileAtomic");
    expect(/writeFile\(\s*join\(dir,\s*"meta\.json"/.test(text)).toBe(false);
  });

  it("webhook-endpoints.ts 不再留「待做」的过期注释", () => {
    expect(src("../../src/server/webhook-endpoints.ts")).not.toContain("待做");
  });

  it("saveNotifyConfig 落盘内容仍可正常读回", async () => {
    const home = mkdtempSync(join(tmpdir(), "kp-notify-"));
    await saveNotifyConfig({ enabled: true } as never, home);
    const raw = rf(join(home, ".kunpeng", "notify.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ enabled: true });
  });
});