import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchKunpeng, type SpawnFn } from "../src/server/launch.js";

interface CapturedLaunchOptions {
  detached: boolean;
  cwd: string;
  stdio: ["ignore", number, number];
}

let cwd: string;

beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "kp-launch-")); });
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

test("stdout/stderr 指向同一日志 fd、detached、返回 {pid,logPath}、日志落地", () => {
  let captured: CapturedLaunchOptions | undefined;
  const fakeSpawn = ((_e: string, _a: string[], opts: unknown) => {
    captured = opts as CapturedLaunchOptions;
    return { pid: 4242, unref() {} } as ReturnType<SpawnFn>;
  }) as SpawnFn;
  const r = launchKunpeng({ execPath: "node", cliJs: "cli.js", spawn: fakeSpawn }, ["run", "做点事"], cwd);
  expect(r.pid).toBe(4242);
  expect(r.logPath.includes(join(".kunpeng", "cockpit", "logs"))).toBe(true);
  expect(existsSync(r.logPath)).toBe(true);
  expect(captured?.detached).toBe(true);
  expect(captured?.cwd).toBe(cwd);
  expect(captured?.stdio[0]).toBe("ignore");
  expect(typeof captured?.stdio[1]).toBe("number");
  expect(captured?.stdio[1]).toBe(captured?.stdio[2]);
});

test("子进程无 pid → 抛，且不留空日志孤儿", () => {
  const noPid = (() => ({ unref() {} }) as ReturnType<SpawnFn>) as SpawnFn;
  const logsDir = join(cwd, ".kunpeng", "cockpit", "logs");
  expect(() => launchKunpeng({ execPath: "node", cliJs: "cli.js", spawn: noPid }, ["run", "x"], cwd)).toThrow();
  // 启动失败不得留下空日志文件（缺陷修复：no-pid 删孤儿）
  const leftover = existsSync(logsDir) ? readdirSync(logsDir) : [];
  expect(leftover).toEqual([]);
});
