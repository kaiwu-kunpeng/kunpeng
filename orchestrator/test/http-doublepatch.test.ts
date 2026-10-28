import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { FlowTracker } from "../src/runtime/flowstate.js";
import { startDashboard } from "../src/server/http.js";
import type { SpawnFn } from "../src/server/launch.js";

let repo: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-http2-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t").addConfig("user.name", "t");
  await g.checkoutLocalBranch("main");
  writeFileSync(join(repo, "a.txt"), "base");
  await g.add("a.txt");
  await g.commit("base");
  await g.checkoutLocalBranch("kp/f1");
  writeFileSync(join(repo, "b.txt"), "feat");
  await g.add("b.txt");
  await g.commit("feat");
  await g.checkout("main");
  const t = new FlowTracker(join(repo, ".kunpeng", "state"));
  await t.start("f1", "x");
  await t.finish("f1", "verified", { gate: "合并主干 (人工门#1)", what: "kp/f1 → main" });
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("/api/merge 经 mergeAndClearGate 合并并清门", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "current", flowId: "f1", target: "main" }),
    });
    expect((await res.json()).ok).toBe(true);
    expect((await new FlowTracker(join(repo, ".kunpeng", "state")).read("f1"))!.humanGate).toBeUndefined();
  } finally {
    srv.close();
  }
});

test("/api/run 返回 logPath 且日志文件落地", async () => {
  const fakeSpawn = (() => ({ pid: 999, unref() {} }) as ReturnType<SpawnFn>) as SpawnFn;
  const srv = await startDashboard({ port: 0, repoRoot: repo, execPath: "node", cliJs: "cli.js", spawn: fakeSpawn });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "current", requirement: "做点事" }),
    });
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.pid).toBe(999);
    expect(typeof j.logPath).toBe("string");
    expect(existsSync(j.logPath)).toBe(true);
  } finally {
    srv.close();
  }
});
