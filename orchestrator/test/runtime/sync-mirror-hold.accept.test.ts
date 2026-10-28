import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderServiceFiles, type ServiceTopology } from "../../src/runtime/service-templates.js";
import { classifySensitiveFiles } from "../../src/runtime/sensitive-paths.js";

const ORCH = new URL("../../", import.meta.url).pathname;
const SYNC = join(ORCH, "..", "deploy", "scripts", "sync-mirror.sh");
const INSTALL = "node -e \"require('fs').writeFileSync('installed.txt','1')\"";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
}

let tmp: string;
let repo: string;
let mirror: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kp-hold-"));
  repo = join(tmp, "repo");
  mkdirSync(join(repo, "orchestrator"), { recursive: true });
  writeFileSync(join(repo, "orchestrator", "package.json"), JSON.stringify({ name: "x", scripts: { build: "node -e \"require('fs').writeFileSync('built.txt','ok')\"" } }));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "one");
  mirror = join(tmp, "mirror");
  git(repo, "worktree", "add", "-q", "--detach", mirror, "main");
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function advanceMain(changeDeps: boolean): void {
  writeFileSync(join(repo, "note.txt"), String(Math.random()));
  if (changeDeps) {
    writeFileSync(join(repo, "orchestrator", "package.json"), JSON.stringify({ name: "x", version: "2.0.0", scripts: { build: "node -e \"require('fs').writeFileSync('built.txt','ok')\"" } }));
  }
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "advance");
}

function runSync(extraEnv: Record<string, string>) {
  return spawnSync("bash", [SYNC, mirror], { encoding: "utf8", env: { ...process.env, KUNPENG_CRON_HOLD: join(tmp, "no-hold.json"), KUNPENG_SYNC_INSTALL_CMD: INSTALL, ...extraEnv } });
}

describe("sync-mirror.sh 评估器冻结闸", () => {
  it("hold 文件存在 → 不追 main、不重编译、输出含 cron-hold", () => {
    const before = git(mirror, "rev-parse", "HEAD");
    advanceMain(false);
    const hold = join(tmp, "cron-hold.json");
    writeFileSync(hold, JSON.stringify({ reason: "gate change observe" }));
    const r = runSync({ KUNPENG_CRON_HOLD: hold });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain("cron-hold");
    expect(git(mirror, "rev-parse", "HEAD")).toBe(before);
    expect(existsSync(join(mirror, "orchestrator", "built.txt"))).toBe(false);
  });

  it("hold 不存在 → 照常追平并重编译", () => {
    advanceMain(false);
    const r = runSync({});
    expect(r.status).toBe(0);
    expect(git(mirror, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "main"));
    expect(existsSync(join(mirror, "orchestrator", "built.txt"))).toBe(true);
  });
});

describe("sync-mirror.sh 依赖清单变才安装", () => {
  it("清单有变化且 node_modules 是真目录 → 执行安装", () => {
    mkdirSync(join(mirror, "orchestrator", "node_modules"));
    advanceMain(true);
    const r = runSync({});
    expect(r.status).toBe(0);
    expect(existsSync(join(mirror, "orchestrator", "installed.txt"))).toBe(true);
    expect(existsSync(join(mirror, "orchestrator", "built.txt"))).toBe(true);
  });

  it("清单有变化但 node_modules 是软链 → 不安装，输出含 symlink", () => {
    const shared = join(tmp, "shared-node-modules");
    mkdirSync(shared);
    symlinkSync(shared, join(mirror, "orchestrator", "node_modules"));
    advanceMain(true);
    const r = runSync({});
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain("symlink");
    expect(existsSync(join(mirror, "orchestrator", "installed.txt"))).toBe(false);
    expect(existsSync(join(mirror, "orchestrator", "built.txt"))).toBe(true);
  });

  it("清单无变化 → 不安装", () => {
    mkdirSync(join(mirror, "orchestrator", "node_modules"));
    advanceMain(false);
    const r = runSync({});
    expect(r.status).toBe(0);
    expect(existsSync(join(mirror, "orchestrator", "installed.txt"))).toBe(false);
  });
});

describe("服务模板与敏感名单", () => {
  const topo: ServiceTopology = {
    home: "/home/op", nodeBin: "/usr/bin/node", repoRoot: "/srv/kp", serveDir: "/srv/kp-serve",
    cronDir: "/srv/kp-cron", port: 7799, logDir: "/home/op/.kunpeng/logs",
  };

  it("sync-cron 执行 cron 镜像内的脚本，不执行主仓工作区那份", () => {
    const files = renderServiceFiles("launchd", topo);
    const sync = files.find((f) => f.file === "com.kunpeng.sync-cron.plist")?.content ?? "";
    expect(sync).toContain("<string>/srv/kp-cron/deploy/scripts/sync-mirror.sh</string>");
    expect(sync).not.toContain("<string>/srv/kp/deploy/scripts/sync-mirror.sh</string>");
  });

  it("deploy/scripts 判敏感，docs 不判", () => {
    expect(classifySensitiveFiles(["deploy/scripts/sync-mirror.sh"]).sensitive).toBe(true);
    expect(classifySensitiveFiles(["docs/deploy/scripts-notes.md"]).sensitive).toBe(false);
  });
});