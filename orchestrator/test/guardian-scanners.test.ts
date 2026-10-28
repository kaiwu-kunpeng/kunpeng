import { expect, test } from "vitest";
import { DEFAULT_SCANNERS } from "../src/loop/guardian.js";

test("DEFAULT_SCANNERS 含 sync-fs 与 console-log，单 grep+--exclude（不用 || true 吞扫描失败）", () => {
  const names = DEFAULT_SCANNERS.map((s) => s.name);
  expect(names).toContain("sync-fs");
  expect(names).toContain("console-log");
  for (const s of DEFAULT_SCANNERS) {
    expect(s.cmd.length).toBeGreaterThan(0);
    expect(s.cmd).not.toContain("|| true");      // 与 todo 同姿态：真崩要冒泡、不静默当无发现
  }
  expect(DEFAULT_SCANNERS.find((s) => s.name === "sync-fs")!.cmd).toContain("--exclude");
});
