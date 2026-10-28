import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startDashboard } from "../../src/server/http.js";

const httpSource = readFileSync(
  fileURLToPath(new URL("../../src/server/http.ts", import.meta.url)),
  "utf8",
);

const roots: string[] = [];

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
});

describe("close() 必须等 gate-watch 在途扫描落地", () => {
  it("源码里不再有被丢弃的 void stopGateWatch()", () => {
    expect(httpSource).not.toContain("void stopGateWatch()");
  });

  it("close 的类型已是 () => Promise<void>", () => {
    expect(httpSource).toContain("close: () => Promise<void>");
  });

  it("close() 返回值是个 thenable(可 await)", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-closeawait-t-"));
    roots.push(repo);
    const stateDir = join(repo, "state");
    mkdirSync(stateDir, { recursive: true });
    const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
    const returned = srv.close() as unknown;
    expect(typeof (returned as { then?: unknown }).then).toBe("function");
    await returned;
  });

  it("await close() 之后目录内容不再变化——连做 8 轮都不许有一次例外", async () => {
    for (let round = 0; round < 8; round += 1) {
      const repo = mkdtempSync(join(tmpdir(), "kp-closeawait-"));
      roots.push(repo);
      const stateDir = join(repo, "state");
      mkdirSync(stateDir, { recursive: true });
      const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
      await srv.close();
      const snapshot = listAll(stateDir);
      await sleep(120);
      expect(listAll(stateDir), `第 ${round + 1} 轮出现了 close 之后的写入`).toEqual(snapshot);
      expect(snapshot.filter((name) => name.endsWith(".tmp")), `第 ${round + 1} 轮快照里仍有临时文件`).toEqual([]);
    }
  });

  it("await close() 之后目录能删净且不会重新冒出", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-closeawait-rm-"));
    roots.push(repo);
    const stateDir = join(repo, "state");
    mkdirSync(stateDir, { recursive: true });
    const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
    await srv.close();
    rmSync(stateDir, { recursive: true, force: true });
    await sleep(200);
    expect(existsSync(stateDir)).toBe(false);
  });
});