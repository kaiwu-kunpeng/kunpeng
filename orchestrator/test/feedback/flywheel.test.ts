import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { countActiveLocks, runFlywheelRound } from "../../src/feedback/flywheel.js";
import type { DriveReport } from "../../src/feedback/drive-backlog.js";

const dirs: string[] = [];

function driveReport(overrides: Partial<DriveReport> = {}): DriveReport {
  return {
    picked: 1,
    consumed: 1,
    failed: 0,
    deferred: 0,
    outcomes: [],
    ...overrides,
  };
}

async function makeDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("countActiveLocks 数 .lock 目录", async () => {
  const dir = await makeDir("kunpeng-flywheel-locks-");
  await mkdir(join(dir, "one.lock"));
  await mkdir(join(dir, "two.lock"));
  await mkdir(join(dir, "plain"));
  await writeFile(join(dir, "foo.lock"), "");

  await expect(countActiveLocks(dir)).resolves.toBe(2);
});

test("countActiveLocks 目录不存在→0", async () => {
  const dir = await makeDir("kunpeng-flywheel-missing-parent-");

  await expect(countActiveLocks(join(dir, "missing"))).resolves.toBe(0);
});

test("runFlywheelRound 无活锁→扫描+驱动都跑", async () => {
  const drive = vi.fn<() => Promise<DriveReport>>(async () => driveReport());

  const report = await runFlywheelRound({
    scan: async () => ({ added: ["a"], pending: 3 }),
    activeLocks: async () => 0,
    drive,
  });

  expect(report.scanned).toEqual({ added: 1, pending: 3 });
  expect(report.skipped).toBeUndefined();
  expect(report.drive?.picked).toBe(1);
  expect(drive).toHaveBeenCalledTimes(1);
});

test("忙碌→扫描仍跑但驱动被跳过", async () => {
  const drive = vi.fn<() => Promise<DriveReport>>(async () => driveReport());

  const report = await runFlywheelRound({
    scan: async () => ({ added: ["a", "b"], pending: 4 }),
    activeLocks: async () => 2,
    drive,
  });

  expect(report.skipped).toBe("busy");
  expect(report.drive).toBeUndefined();
  expect(drive).toHaveBeenCalledTimes(0);
  expect(report.scanned).toEqual({ added: 2, pending: 4 });
});

test("不传 scan→只驱动", async () => {
  const report = await runFlywheelRound({
    activeLocks: async () => 0,
    drive: async () => driveReport({ picked: 2 }),
  });

  expect(report.scanned).toBeUndefined();
  expect(report.drive?.picked).toBe(2);
});
