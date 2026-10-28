// 作者锁定（2026-09-28 审计 R05b）：运行拓扑进仓库——kunpeng install --service 从模板生成服务文件，路径参数化、不含密钥、不替人加载。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderServiceFiles, resolveCronRoot, resolveServeRoot, serviceLoadHint, type ServiceTopology } from "../../src/runtime/service-templates.js";
import { dispatchCliCommand, type CliContext } from "../../src/cli-commands/registry.js";
import "../../src/cli-commands/deploy.js";

const ORCH = new URL("../../", import.meta.url).pathname;
const REPO = join(ORCH, "..");
const SYNC = join(REPO, "deploy", "scripts", "sync-mirror.sh");

const topo: ServiceTopology = {
  home: "/home/op",
  nodeBin: "/usr/bin/node",
  repoRoot: "/srv/kp",
  serveDir: "/srv/kp-serve",
  cronDir: "/srv/kp-cron",
  port: 7799,
  logDir: "/home/op/.kunpeng/logs",
};

const SECRET_KEYS = ["NEON_DATABASE_URL", "DRAIN_KEY", "INDEXNOW_KEY", "KP_CHAT_MCP", "DATABASE_URL", "API_KEY"];

let tmp: string;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kp-svc-"));
  saved = { s: process.env.KUNPENG_SERVE_DIR, c: process.env.KUNPENG_CRON_DIR };
  delete process.env.KUNPENG_SERVE_DIR;
  delete process.env.KUNPENG_CRON_DIR;
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (saved.s === undefined) delete process.env.KUNPENG_SERVE_DIR; else process.env.KUNPENG_SERVE_DIR = saved.s;
  if (saved.c === undefined) delete process.env.KUNPENG_CRON_DIR; else process.env.KUNPENG_CRON_DIR = saved.c;
  vi.restoreAllMocks();
});

describe("镜像目录解析", () => {
  it("环境变量优先，缺省落在 home 下", () => {
    expect(resolveServeRoot({}, "/h")).toBe("/h/kunpeng-serve");
    expect(resolveCronRoot({}, "/h")).toBe("/h/kunpeng-cron");
    expect(resolveServeRoot({ KUNPENG_SERVE_DIR: "/x/s" }, "/h")).toBe("/x/s");
    expect(resolveCronRoot({ KUNPENG_CRON_DIR: "/x/c" }, "/h")).toBe("/x/c");
  });

  it("deploy.ts 不再硬编码 ~/kunpeng-serve，且不替人执行 launchctl/systemctl", () => {
    const src = readFileSync(join(ORCH, "src", "cli-commands", "deploy.ts"), "utf8");
    expect(src).not.toContain('join(homedir(), "kunpeng-serve")');
    expect(src).toContain("resolveServeRoot(");
    expect(src).not.toMatch(/exec\w*\(\s*["'](launchctl|systemctl)/);
  });
});

describe("launchd 模板", () => {
  const files = renderServiceFiles("launchd", topo);
  const byName = new Map(files.map((f) => [f.file, f.content]));

  it("不给隧道名时生成 serve/autopilot/sync-cron 三份，给了再加 tunnel", () => {
    expect([...byName.keys()].sort()).toEqual(["com.kunpeng.autopilot.plist", "com.kunpeng.serve.plist", "com.kunpeng.sync-cron.plist"]);
    const withTunnel = renderServiceFiles("launchd", { ...topo, tunnel: "kp-tun", cloudflaredBin: "/usr/bin/cloudflared" });
    const t = withTunnel.find((f) => f.file === "com.kunpeng.tunnel.plist");
    expect(t?.content).toContain("<string>kp-tun</string>");
    expect(t?.content).toContain("<key>KeepAlive</key><true/>");
  });

  it("serve 常驻、路径与端口来自参数", () => {
    const serve = byName.get("com.kunpeng.serve.plist") ?? "";
    expect(serve).toContain("<key>KeepAlive</key><true/>");
    expect(serve).toContain("<string>/srv/kp-serve/orchestrator/dist/cli.js</string>");
    expect(serve).toContain("<string>7799</string>");
    expect(serve).toContain("<string>/srv/kp-serve/orchestrator</string>");
  });

  it("autopilot 每 1800 秒跑 cron 镜像并带 --repo；sync-cron 每 300 秒调仓内脚本同步 cron 镜像", () => {
    const ap = byName.get("com.kunpeng.autopilot.plist") ?? "";
    expect(ap).toContain("<integer>1800</integer>");
    expect(ap).toContain("<string>/srv/kp-cron/orchestrator/dist/cli.js</string>");
    expect(ap).toContain("<string>--repo</string>");
    expect(ap).not.toMatch(/KeepAlive/);
    const sync = byName.get("com.kunpeng.sync-cron.plist") ?? "";
    expect(sync).toContain("<integer>300</integer>");
    expect(sync).toContain("<string>/srv/kp-cron/deploy/scripts/sync-mirror.sh</string>");
    expect(sync).toContain("<string>/srv/kp-cron</string>");
  });

  it("任何模板都不含密钥变量名，也不含开发机的个人路径", () => {
    for (const f of [...renderServiceFiles("launchd", topo), ...renderServiceFiles("systemd", topo)]) {
      for (const key of SECRET_KEYS) expect(f.content).not.toContain(key);
      expect(f.content).not.toContain("/Users/");
    }
  });

  it.runIf(process.platform === "darwin")("plutil -lint 判定每份 plist 合法", () => {
    for (const f of renderServiceFiles("launchd", { ...topo, tunnel: "kp-tun" })) {
      const p = join(tmp, f.file);
      writeFileSync(p, f.content);
      execFileSync("plutil", ["-lint", p]);
    }
  });

  it("加载提示逐个给 bootstrap 命令", () => {
    const hint = serviceLoadHint("launchd", "/out", files);
    for (const f of files) expect(hint).toContain(`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${f.file}`);
  });
});

describe("systemd 模板", () => {
  const files = renderServiceFiles("systemd", topo);
  const byName = new Map(files.map((f) => [f.file, f.content]));

  it("serve 是常驻 service，定时任务是 service+timer 成对", () => {
    expect([...byName.keys()].sort()).toEqual([
      "kunpeng-autopilot.service", "kunpeng-autopilot.timer",
      "kunpeng-serve.service",
      "kunpeng-sync-cron.service", "kunpeng-sync-cron.timer",
    ]);
    const serve = byName.get("kunpeng-serve.service") ?? "";
    expect(serve).toContain("Restart=always");
    expect(serve).toContain("ExecStart=/usr/bin/node /srv/kp-serve/orchestrator/dist/cli.js serve 7799");
    expect(serve).toContain("EnvironmentFile=-%h/.config/kunpeng/kunpeng.env");
    expect(byName.get("kunpeng-autopilot.timer")).toContain("OnUnitActiveSec=1800");
    expect(byName.get("kunpeng-sync-cron.timer")).toContain("OnUnitActiveSec=300");
  });

  it("加载提示启用常驻 service 与各 timer，不直接启用被 timer 驱动的 service", () => {
    const hint = serviceLoadHint("systemd", "/out", files);
    expect(hint).toContain("systemctl --user daemon-reload");
    expect(hint).toContain("systemctl --user enable --now kunpeng-serve.service");
    expect(hint).toContain("systemctl --user enable --now kunpeng-autopilot.timer");
    expect(hint).not.toContain("enable --now kunpeng-autopilot.service");
  });
});

function ctx(rest: string[], outArg?: string): CliContext {
  return { repoRoot: "/srv/kp", kunpengHome: "/srv/kp", rest, argv: ["install", ...rest], flags: new Set(), ...(outArg ? { outArg } : {}) };
}

describe("kunpeng install --service（CLI 接线）", () => {
  it("写出当前平台的服务文件（600 权限），参数生效，并打印加载命令", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
    const found = await dispatchCliCommand("install", ctx(["--service", "--port", "7799", "--serve-dir", "/opt/s", "--cron-dir", "/opt/c"], tmp));
    expect(found).toBe(true);
    const written = readdirSync(tmp).sort();
    if (process.platform === "darwin") {
      expect(written).toEqual(["com.kunpeng.autopilot.plist", "com.kunpeng.serve.plist", "com.kunpeng.sync-cron.plist"]);
      const serve = readFileSync(join(tmp, "com.kunpeng.serve.plist"), "utf8");
      expect(serve).toContain("<string>/opt/s/orchestrator/dist/cli.js</string>");
      expect(serve).toContain("<string>7799</string>");
      expect(readFileSync(join(tmp, "com.kunpeng.autopilot.plist"), "utf8")).toContain("<string>/opt/c/orchestrator/dist/cli.js</string>");
      expect(logs.join("\n")).toContain("launchctl bootstrap");
    } else {
      expect(written).toContain("kunpeng-serve.service");
      expect(logs.join("\n")).toContain("systemctl --user");
    }
    for (const f of written) expect(statSync(join(tmp, f)).mode & 0o777).toBe(0o600);
  });

  it("缺 --service 或端口非法 → 以非零退出", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);
    await expect(dispatchCliCommand("install", ctx([], tmp))).rejects.toThrow("exit:1");
    await expect(dispatchCliCommand("install", ctx(["--service", "--port", "99999"], tmp))).rejects.toThrow("exit:1");
    expect(readdirSync(tmp)).toEqual([]);
  });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
}

describe("deploy/scripts/sync-mirror.sh（真 git 仓）", () => {
  it("脚本存在、可执行、语法正确", () => {
    expect(existsSync(SYNC)).toBe(true);
    expect(statSync(SYNC).mode & 0o111).not.toBe(0);
    expect(spawnSync("bash", ["-n", SYNC]).status).toBe(0);
  });

  it("detached 镜像落后 main 时追平并重编译；已对齐时不重编译；在分支上时拒绝", () => {
    const repo = join(tmp, "repo");
    mkdirSync(join(repo, "orchestrator"), { recursive: true });
    writeFileSync(join(repo, "orchestrator", "package.json"), JSON.stringify({ name: "x", scripts: { build: "node -e \"require('fs').writeFileSync('built.txt','ok')\"" } }));
    git(repo, "init", "-q", "-b", "main");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "one");
    const mirror = join(tmp, "mirror");
    git(repo, "worktree", "add", "-q", "--detach", mirror, "main");
    writeFileSync(join(repo, "note.txt"), "two");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "two");

    const r1 = spawnSync("bash", [SYNC, mirror], { encoding: "utf8" });
    expect(r1.status).toBe(0);
    expect(git(mirror, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "main"));
    expect(existsSync(join(mirror, "orchestrator", "built.txt"))).toBe(true);

    rmSync(join(mirror, "orchestrator", "built.txt"));
    const r2 = spawnSync("bash", [SYNC, mirror], { encoding: "utf8" });
    expect(r2.status).toBe(0);
    expect(existsSync(join(mirror, "orchestrator", "built.txt"))).toBe(false);

    const r3 = spawnSync("bash", [SYNC, repo], { encoding: "utf8" });
    expect(r3.status).not.toBe(0);
    expect(r3.stderr).toContain("detached");

    const r4 = spawnSync("bash", [SYNC, join(tmp, "nope")], { encoding: "utf8" });
    expect(r4.status).not.toBe(0);
  });
});