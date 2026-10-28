import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ORCH = new URL("../../", import.meta.url).pathname;
const SCRIPTS = join(ORCH, "..", "deploy", "scripts");
const GUARD = join(SCRIPTS, "launchd-guard.sh");
const SYNC = join(SCRIPTS, "sync-mirror.sh");

let tmp: string;
let bin: string;
let calls: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kp-guard-"));
  bin = join(tmp, "bin");
  mkdirSync(bin);
  calls = join(tmp, "calls.log");
  writeFileSync(calls, "");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function stub(name: string, body: string): void {
  const p = join(bin, name);
  writeFileSync(p, `#!/bin/bash\necho "${name} $*" >> "${calls}"\n${body}\n`);
  chmodSync(p, 0o755);
}

function callLines(): string[] {
  return readFileSync(calls, "utf8").split("\n").filter(Boolean);
}

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: tmp,
    KUNPENG_GUARD_FORCE: "1",
    KUNPENG_UID: "501",
    KUNPENG_SYNC_LOG: join(tmp, "logs", "sync.log"),
    KUNPENG_SYNC_MARK_DIR: join(tmp, "marks"),
    KUNPENG_CRON_HOLD: join(tmp, "no-hold.json"),
    KUNPENG_SYNC_PATCH: join(tmp, "discarded.patch"),
    KUNPENG_NODE: join(bin, "node"),
    KUNPENG_LAUNCHCTL: join(bin, "launchctl"),
    ...extra,
  };
}

describe("launchd-guard.sh", () => {
  let agents: string;
  beforeEach(() => {
    agents = join(tmp, "LaunchAgents");
    mkdirSync(agents);
    mkdirSync(join(tmp, "marks"));
    for (const l of ["gone", "paused", "alive"]) writeFileSync(join(agents, `com.kunpeng.${l}.plist`), "<plist/>");
    stub("launchctl", [
      'if [ "$1" = "print-disabled" ]; then echo \'"com.kunpeng.paused" => disabled\'; exit 0; fi',
      'if [ "$1" = "print" ]; then case "$2" in */com.kunpeng.alive) echo "state = running"; exit 0;; *) exit 113;; esac; fi',
      "exit 0",
    ].join("\n"));
    stub("node", "exit 0");
  });

  it("脚本存在、可执行、语法正确", () => {
    expect(existsSync(GUARD)).toBe(true);
    expect(spawnSync("bash", ["-n", GUARD]).status).toBe(0);
  });

  it("掉线任务补挂；显式 disabled 与已在的不动", () => {
    const r = spawnSync("bash", [GUARD], { encoding: "utf8", env: baseEnv({ KUNPENG_LAUNCHAGENTS_DIR: agents, KUNPENG_CLI: "/x/cli.js" }) });
    expect(r.status).toBe(0);
    const lines = callLines();
    expect(lines).toContain(`launchctl bootstrap gui/501 ${join(agents, "com.kunpeng.gone.plist")}`);
    expect(lines.some((l) => l.includes("bootstrap") && l.includes("paused"))).toBe(false);
    expect(lines.some((l) => l.includes("bootstrap") && l.includes("alive"))).toBe(false);
    expect(readFileSync(join(tmp, "logs", "sync.log"), "utf8")).toContain("com.kunpeng.gone");
  });

  it("缺 LWCR：首跑提醒一次，24 小时内不重复；无缺口清标记", () => {
    const env = baseEnv({ KUNPENG_LAUNCHAGENTS_DIR: agents, KUNPENG_CLI: "/x/cli.js" });
    spawnSync("bash", [GUARD], { encoding: "utf8", env });
    const sends1 = callLines().filter((l) => l.startsWith("node /x/cli.js send all"));
    expect(sends1).toHaveLength(1);
    expect(sends1[0]).toContain("alive");
    expect(existsSync(join(tmp, "marks", ".kp-lwcr-reminded"))).toBe(true);
    spawnSync("bash", [GUARD], { encoding: "utf8", env });
    expect(callLines().filter((l) => l.startsWith("node /x/cli.js send all"))).toHaveLength(1);

    stub("launchctl", [
      'if [ "$1" = "print-disabled" ]; then exit 0; fi',
      'if [ "$1" = "print" ]; then echo "properties = managed LWCR"; exit 0; fi',
      "exit 0",
    ].join("\n"));
    spawnSync("bash", [GUARD], { encoding: "utf8", env });
    expect(existsSync(join(tmp, "marks", ".kp-lwcr-reminded"))).toBe(false);
  });

  it("标记超过 24 小时 → 再提醒", () => {
    const env = baseEnv({ KUNPENG_LAUNCHAGENTS_DIR: agents, KUNPENG_CLI: "/x/cli.js" });
    const mark = join(tmp, "marks", ".kp-lwcr-reminded");
    writeFileSync(mark, "");
    const old = Date.now() / 1000 - 90_000;
    utimesSync(mark, old, old);
    spawnSync("bash", [GUARD], { encoding: "utf8", env });
    expect(callLines().filter((l) => l.startsWith("node /x/cli.js send all"))).toHaveLength(1);
  });
});

describe("sync-mirror.sh 收编的兜底", () => {
  let repo: string;
  let mirror: string;

  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  }

  function setup(buildOk: boolean): void {
    repo = join(tmp, "repo");
    mkdirSync(join(repo, "orchestrator", "dist"), { recursive: true });
    const build = buildOk ? "node -e \"require('fs').writeFileSync('built.txt','ok')\"" : "node -e \"process.exit(3)\"";
    writeFileSync(join(repo, "orchestrator", "package.json"), JSON.stringify({ name: "x", scripts: { build } }));
    writeFileSync(join(repo, "orchestrator", "dist", "cli.js"), "// old dist\n");
    writeFileSync(join(repo, "tracked.txt"), "v1\n");
    git(repo, "init", "-q", "-b", "main");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "one");
    mirror = join(tmp, "mirror");
    git(repo, "worktree", "add", "-q", "--detach", mirror, "main");
    writeFileSync(join(repo, "note.txt"), "two");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "two");
    mkdirSync(join(tmp, "marks"), { recursive: true });
  }

  it("脏树先存补丁再丢弃，完成追平；构建后调 install-hooks", () => {
    stub("node", "exit 0");
    setup(true);
    writeFileSync(join(mirror, "tracked.txt"), "dirty edit\n");
    const r = spawnSync("bash", [SYNC, mirror], { encoding: "utf8", env: baseEnv({ KUNPENG_LAUNCHAGENTS_DIR: join(tmp, "none") }) });
    expect(r.status).toBe(0);
    expect(readFileSync(join(tmp, "discarded.patch"), "utf8")).toContain("dirty edit");
    expect(git(mirror, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "main"));
    expect(callLines().some((l) => l.includes("install-hooks"))).toBe(true);
  });

  it("install-hooks 失败不让同步失败，且 1 小时内只告警一次", () => {
    stub("node", 'case "$2" in install-hooks) exit 1;; esac\nexit 0');
    setup(true);
    const env = baseEnv({ KUNPENG_LAUNCHAGENTS_DIR: join(tmp, "none") });
    const r = spawnSync("bash", [SYNC, mirror], { encoding: "utf8", env });
    expect(r.status).toBe(0);
    expect(callLines().filter((l) => l.includes("send all") && l.includes("install-hooks"))).toHaveLength(1);
    expect(existsSync(join(tmp, "marks", ".kp-shield-install-fail-alerted"))).toBe(true);
  });

  it("构建失败：告警一次并非零退出", () => {
    stub("node", "exit 0");
    setup(false);
    const r = spawnSync("bash", [SYNC, mirror], { encoding: "utf8", env: baseEnv({ KUNPENG_LAUNCHAGENTS_DIR: join(tmp, "none") }) });
    expect(r.status).not.toBe(0);
    expect(callLines().filter((l) => l.includes("send all"))).toHaveLength(1);
    expect(existsSync(join(tmp, "marks", ".kp-sync-cron-build-fail-alerted"))).toBe(true);
  });
});