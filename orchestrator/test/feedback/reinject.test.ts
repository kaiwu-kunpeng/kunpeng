import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runReinjectScan } from "../../src/feedback/reinject.js";
import { ReinjectStore } from "../../src/feedback/reinject-store.js";
import type { Finding } from "../../src/loop/guardian.js";

const dirs: string[] = [];

async function makeStore(): Promise<ReinjectStore> {
  const dir = await mkdtemp(join(tmpdir(), "kunpeng-reinject-"));
  dirs.push(dir);
  return new ReinjectStore(dir);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("runReinjectScan 缺省只留 error（info/warn 不再入队）、按指纹去重并保持幂等", async () => {
  const store = await makeStore();
  const findings: Finding[] = [
    { scanner: "todo", severity: "info", file: "src/a.ts", line: 1, message: "TODO: later" },
    { scanner: "typecheck", severity: "error", file: "src/a.ts", line: 12, message: "TS2322: type mismatch" },
    { scanner: "typecheck", severity: "error", file: "src/a.ts", line: 31, message: "TS2322: type mismatch" },
    { scanner: "lint", severity: "warn", file: "src/b.ts", line: 2, message: "no-console" },
  ];

  const first = await runReinjectScan({ findings, store, now: 1000 });

  expect(first.scanned).toBe(findings.length);
  expect(first.added).toHaveLength(1);
  expect(first.pending).toBe(1);

  const second = await runReinjectScan({ findings, store, now: 1000 });

  expect(second.added).toHaveLength(0);
  expect(second.skipped.length).toBeGreaterThan(0);
  expect(second.pending).toBe(1);
});

test("runReinjectScan 显式 minSeverity:warn 仍纳入 warn 级发现", async () => {
  const store = await makeStore();
  const findings: Finding[] = [
    { scanner: "lint", severity: "warn", file: "src/b.ts", line: 2, message: "no-console" },
    { scanner: "typecheck", severity: "error", file: "src/a.ts", line: 12, message: "TS2322: type mismatch" },
  ];

  const first = await runReinjectScan({ findings, store, now: 1000, minSeverity: "warn" });

  expect(first.added).toHaveLength(2);
  expect(first.pending).toBe(2);
});