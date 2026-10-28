import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const rootPath = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const root = (p: string) => readFileSync(rootPath(p), "utf8");
const INSTALL_SH = rootPath("install.sh");

let dir: string;
let bin: string;
let npmLog: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-install-backend-"));
  bin = join(dir, "bin");
  npmLog = join(dir, "npm-calls.log");
  spawnSync("mkdir", ["-p", bin]);
  // npm / node 桩：不联网、不真构建，只记账
  stub("npm", `echo "$*" >> "${npmLog}"\nexit 0`);
  stub("node", `if [ "$1" = "-p" ]; then echo 22; exit 0; fi\nif [ "$1" = "--version" ]; then echo v22.0.0; exit 0; fi\nexit 0`);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function stub(name: string, body: string): void {
  const p = join(bin, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}
const claudeReady = () => stub("claude", `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": true}'; exit 0; fi\nexit 0`);
const claudeLoggedOut = () => stub("claude", `if [ "$1 $2" = "auth status" ]; then echo '{"loggedIn": false}'; exit 1; fi\nexit 0`);
const codexReady = () => stub("codex", `if [ "$1 $2" = "login status" ]; then echo "Logged in using ChatGPT"; exit 0; fi\nexit 0`);
const codexLoggedOut = () => stub("codex", `if [ "$1 $2" = "login status" ]; then echo "Not logged in"; exit 1; fi\nexit 0`);
const codexHangs = () => stub("codex", `exec sleep 60`);

function run(args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync("/bin/bash", [INSTALL_SH, ...args], {
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, ...extraEnv },
    encoding: "utf8",
    timeout: 45_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}`, npmCalls: existsSync(npmLog) ? readFileSync(npmLog, "utf8") : "" };
}

describe("install.sh --check-backends：确定性判定 AI 后端（作者锁定）", () => {
  it("两个后端都已安装且已登录 → 退 0，逐个报就绪，且不跑 npm", () => {
    claudeReady();
    codexReady();
    const r = run(["--check-backends"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/claude[^\n]*已登录/);
    expect(r.out).toMatch(/codex[^\n]*已登录/);
    expect(r.npmCalls).toBe("");
  });

  it("两个都没装 → 退 3，给出两条可执行的安装命令", () => {
    const r = run(["--check-backends"]);
    expect(r.code, r.out).toBe(3);
    expect(r.out).toContain("npm install -g @anthropic-ai/claude-code");
    expect(r.out).toContain("npm install -g @openai/codex");
  });

  it("装了但都没登录 → 退 3，给出登录命令（不是安装命令）", () => {
    claudeLoggedOut();
    codexLoggedOut();
    const r = run(["--check-backends"]);
    expect(r.code, r.out).toBe(3);
    expect(r.out).toContain("claude auth login");
    expect(r.out).toContain("codex login");
    expect(r.out).not.toContain("npm install -g @anthropic-ai/claude-code");
  });

  it("只有一个就绪、没钉后端 → 退 0（另一个只报缺失）", () => {
    claudeReady();
    const r = run(["--check-backends"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("npm install -g @openai/codex");
  });

  it("KUNPENG_BACKEND 钉了一个不可用的后端 → 即使另一个就绪也退 3", () => {
    claudeReady();
    codexLoggedOut();
    const r = run(["--check-backends"], { KUNPENG_BACKEND: "codex" });
    expect(r.code, r.out).toBe(3);
    expect(r.out).toContain("KUNPENG_BACKEND");
  });

  it("状态命令卡死不会把脚本挂住：到点判为不可用", () => {
    codexHangs();
    const started = Date.now();
    const r = run(["--check-backends"]);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(r.code, r.out).toBe(3);
    expect(r.out).toContain("codex login");
  }, 40_000);

  it("未知参数 → 非零退出并打印用法，不跑 npm", () => {
    const r = run(["--no-such-flag"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("--check-backends");
    expect(r.npmCalls).toBe("");
  });
});

describe("install.sh 完整安装：构建之后必检后端（作者锁定）", () => {
  it("没有可用后端 → 构建照做，但退 3，并提示复查命令，不打印安装成功", () => {
    const r = run([]);
    expect(r.npmCalls).toMatch(/run build/);
    expect(r.code, r.out).toBe(3);
    expect(r.out).toContain("./install.sh --check-backends");
    expect(r.out).not.toContain("鲲鹏已安装并完成 build");
  });

  it("有可用后端 → 退 0，打印原有的安装成功与下一步", () => {
    codexReady();
    const r = run([]);
    expect(r.code, r.out).toBe(0);
    expect(r.npmCalls).toMatch(/run build/);
    expect(r.out).toContain("鲲鹏已安装并完成 build");
    expect(r.out).toMatch(/codex[^\n]*已登录/);
  });
});

describe("安装手册、镜像与 compose 写明 AI 后端前置（作者锁定）", () => {
  const install = root("docs/runbooks/install.md");
  const dockerfile = root("Dockerfile");
  const compose = root("docker-compose.yml");
  const example = root(".env.example");

  it("安装手册有「AI 后端前置」一节，含安装、登录、复查的真实命令", () => {
    expect(install).toContain("**AI 后端前置**");
    for (const s of [
      "npm install -g @anthropic-ai/claude-code",
      "npm install -g @openai/codex",
      "claude auth login",
      "claude auth status",
      "codex login",
      "codex login status",
      "codex login --device-auth",
      "claude setup-token",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "./install.sh --check-backends",
    ]) {
      expect(install, s).toContain(s);
    }
  });

  it("「AI 后端前置」一节在方式一之前（装之前就得知道）", () => {
    expect(install.indexOf("**AI 后端前置**")).toBeGreaterThan(install.indexOf("**先决条件**"));
    expect(install.indexOf("**AI 后端前置**")).toBeLessThan(install.indexOf("**方式一：原生一键安装**"));
  });

  it("方式一的脚本说明不再只说检查 Node 版本（旧串已换成含后端检查的新说明）", () => {
    expect(install).not.toContain("脚本会检查 Node.js 主版本，安装 orchestrator 依赖并执行构建。构建完成后可前台启动：");
    expect(install).toMatch(/脚本会检查 Node\.js 主版本[^\n]*AI 后端/);
  });

  it("Docker 方式写明容器内登录与凭据目录", () => {
    expect(install).toContain("docker compose exec kunpeng claude auth login");
    expect(install).toContain("docker compose exec kunpeng codex login --device-auth");
    expect(install).toContain("backend-auth/claude");
    expect(install).toContain("backend-auth/codex");
  });

  it("镜像以 root 装好两个 CLI，且在切到 node 用户之前", () => {
    const at = dockerfile.indexOf("npm install -g @anthropic-ai/claude-code @openai/codex");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(dockerfile.indexOf("USER node"));
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toContain('ENTRYPOINT ["node", "dist/cli.js"]');
  });

  it("compose 把两个 CLI 的凭据目录放进持久化的状态目录", () => {
    expect(compose).toMatch(/CLAUDE_CONFIG_DIR:\s*\/var\/lib\/kunpeng\/backend-auth\/claude/);
    expect(compose).toMatch(/CODEX_HOME:\s*\/var\/lib\/kunpeng\/backend-auth\/codex/);
    expect(compose).toContain('"127.0.0.1:7777:7777"');
  });

  it("环境范例给出 Claude 长期令牌的占位（注释态，不带真值）", () => {
    expect(example).toMatch(/^# CLAUDE_CODE_OAUTH_TOKEN=\s*$/m);
  });
});