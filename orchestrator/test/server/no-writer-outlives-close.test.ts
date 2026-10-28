import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDashboard } from "../../src/server/http.js";
import {
  currentGateWatchGeneration,
  shouldWriteGateScan,
  startGateWatch,
} from "../../src/server/push.js";

const roots: string[] = [];

function tempRepo(prefix: string): { repo: string; stateDir: string } {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  roots.push(repo);
  const stateDir = join(repo, "state");
  mkdirSync(stateDir, { recursive: true });
  return { repo, stateDir };
}

function listAll(dir: string): string[] {
  const out: string[] = [];
  const walk = (base: string, prefix: string): void => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) walk(join(base, entry.name), `${rel}/`);
      else out.push(rel);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out.sort();
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("shouldWriteGateScan", () => {
  it("同代且未停止才允许写", () => {
    expect(shouldWriteGateScan(3, 3, false)).toBe(true);
    expect(shouldWriteGateScan(3, 3, true)).toBe(false);
    expect(shouldWriteGateScan(2, 3, false)).toBe(false);
    expect(shouldWriteGateScan(4, 3, false)).toBe(false);
  });
});

describe("代次单调递增", () => {
  it("每次 startGateWatch 都 +1", async () => {
    const before = currentGateWatchGeneration();
    const stopA = startGateWatch(60000);
    const afterA = currentGateWatchGeneration();
    const stopB = startGateWatch(60000);
    const afterB = currentGateWatchGeneration();
    await stopB();
    await stopA().catch(() => undefined);
    expect(afterA).toBe(before + 1);
    expect(afterB).toBe(before + 2);
  });
});

describe("close() 之后没有任何写入与日志", () => {
  it("首次心跳是等待完成的:startDashboard 返回时文件已存在", async () => {
    const { repo, stateDir } = tempRepo("kp-nowriter-hb-");
    const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
    try {
      expect(existsSync(join(stateDir, "serve-heartbeat.json"))).toBe(true);
    } finally {
      srv.close();
    }
  });

  it("close() 后目录内容不再变化,且没有 console.error", async () => {
    const { repo, stateDir } = tempRepo("kp-nowriter-quiet-");
    const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await srv.close();
    const snapshot = listAll(stateDir);
    await sleep(400);
    expect(listAll(stateDir)).toEqual(snapshot);
    expect(spy).not.toHaveBeenCalled();
  });

  it("close() 后目录能一次删净,之后也不会重新冒出文件", async () => {
    const { repo, stateDir } = tempRepo("kp-nowriter-rm-");
    const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
    await srv.close();
    rmSync(stateDir, { recursive: true, force: true });
    expect(existsSync(stateDir)).toBe(false);
    await sleep(400);
    expect(existsSync(stateDir)).toBe(false);
  });

  it("连开两个服务再各自 close:先关的那个目录不会被后开的那次扫描写脏", async () => {
    const first = tempRepo("kp-nowriter-genA-");
    const second = tempRepo("kp-nowriter-genB-");
    const srvA = await startDashboard({ port: 0, repoRoot: first.repo, stateDir: first.stateDir });
    await srvA.close();
    const snapshotA = listAll(first.stateDir);
    const srvB = await startDashboard({ port: 0, repoRoot: second.repo, stateDir: second.stateDir });
    await sleep(300);
    await srvB.close();
    await sleep(300);
    expect(listAll(first.stateDir)).toEqual(snapshotA);
  });
});
