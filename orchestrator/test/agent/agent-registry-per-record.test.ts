import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  registerAgent,
  formatAgentRegistryRecord,
  agentRegistryRecordFileName,
} from "../../src/agent/agent-registry.js";
import { PresenceStore } from "../../src/switchboard/presence.js";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-agentreg-"));
  mkdirSync(join(dir, ".kunpeng"), { recursive: true });
  writeFileSync(join(dir, ".kunpeng", "project.json"), JSON.stringify({ id: "demo", name: "demo" }), "utf8");
  return dir;
}

function presenceStore(): PresenceStore {
  return new PresenceStore(mkdtempSync(join(tmpdir(), "kp-presence-")));
}

const inferDeps = (repo: string) => ({ projects: [{ id: "demo", name: "demo", repoPath: repo }] }) as never;

describe("formatAgentRegistryRecord", () => {
  it("五项信息一个都不少", () => {
    const out = formatAgentRegistryRecord({
      iso: "2026-08-15T05:18:41.077Z",
      instance: "cc-demo-123",
      projectId: "demo",
      cwd: "/repo/wt/x",
      task: "干活",
    });
    expect(out).toContain("2026-08-15T05:18:41.077Z");
    expect(out).toContain("cc-demo-123");
    expect(out).toContain("demo");
    expect(out).toContain("/repo/wt/x");
    expect(out).toContain("干活");
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("agentRegistryRecordFileName", () => {
  it("按文件名排序即时间序,且不含冒号与路径分隔符", () => {
    const a = agentRegistryRecordFileName("2026-08-15T05:18:41.077Z", "cc-a");
    const b = agentRegistryRecordFileName("2026-08-15T06:00:00.000Z", "cc-a");
    expect(a.startsWith("2026-08-15")).toBe(true);
    expect(a < b).toBe(true);
    expect(a).not.toContain(":");
    expect(a).not.toContain("/");
    expect(a).not.toContain("\\");
    expect(a.endsWith(".md")).toBe(true);
  });

  it("实例名里的怪字符被规整,且纯函数可重复", () => {
    const n = agentRegistryRecordFileName("2026-08-15T05:18:41.077Z", "cc/weird:name #1");
    expect(n).not.toContain("/");
    expect(n).not.toContain(":");
    expect(n).not.toContain(" ");
    expect(agentRegistryRecordFileName("2026-08-15T05:18:41.077Z", "cc/weird:name #1")).toBe(n);
  });
});

describe("registerAgent 一次登记一个文件", () => {
  it("落到 .kunpeng/agents-active/ 且不再写 AGENTS-ACTIVE.md", async () => {
    const repo = makeRepo();
    const r = await registerAgent({
      instance: "i-solo", cwd: repo, task: "干活", now: Date.parse("2026-08-15T05:18:41.077Z"),
      presence: presenceStore(), inferDeps: inferDeps(repo),
    });

    const dir = join(repo, ".kunpeng", "agents-active");
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    const body = readFileSync(join(dir, files[0]), "utf8");
    expect(body).toContain("i-solo");
    expect(body).toContain("干活");
    expect(r.mdPath).toBe(join(dir, files[0]));
    expect(existsSync(join(repo, "AGENTS-ACTIVE.md"))).toBe(false);
  });

  it("要害:两个实例并发登记落到两个不同文件(冲突面归零)", async () => {
    const repo = makeRepo();
    const now = Date.parse("2026-08-15T05:18:41.077Z");
    await Promise.all([
      registerAgent({ instance: "i-a", cwd: repo, task: "A", now, presence: presenceStore(), inferDeps: inferDeps(repo) }),
      registerAgent({ instance: "i-b", cwd: repo, task: "B", now, presence: presenceStore(), inferDeps: inferDeps(repo) }),
    ]);
    const files = readdirSync(join(repo, ".kunpeng", "agents-active"));
    expect(files.length).toBe(2);
    expect(new Set(files).size).toBe(2);
    const bodies = files.map((f) => readFileSync(join(repo, ".kunpeng", "agents-active", f), "utf8")).join("");
    expect(bodies).toContain("i-a");
    expect(bodies).toContain("i-b");
  });

  it("同一毫秒同一实例登记两次不得互相覆盖", async () => {
    const repo = makeRepo();
    const now = Date.parse("2026-08-15T05:18:41.077Z");
    await registerAgent({ instance: "i-dup", cwd: repo, task: "first", now, presence: presenceStore(), inferDeps: inferDeps(repo) });
    await registerAgent({ instance: "i-dup", cwd: repo, task: "second", now, presence: presenceStore(), inferDeps: inferDeps(repo) });
    const dir = join(repo, ".kunpeng", "agents-active");
    const files = readdirSync(dir);
    expect(files.length).toBe(2);
    const bodies = files.map((f) => readFileSync(join(dir, f), "utf8")).join("");
    expect(bodies).toContain("first");
    expect(bodies).toContain("second");
  });

  it("推断不到项目:不抛异常、mdPath 为 null、presence 仍写入", async () => {
    const presence = presenceStore();
    const orphan = mkdtempSync(join(tmpdir(), "kp-orphan-"));
    const r = await registerAgent({
      instance: "i-orphan", cwd: orphan, task: "无项目", now: Date.now(),
      presence, inferDeps: { projects: [] } as never,
    });
    expect(r.projectId).toBeNull();
    expect(r.mdPath).toBeNull();
    expect((await presence.list()).some((h) => h.instance === "i-orphan")).toBe(true);
  });
});