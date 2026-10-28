import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CliRunner } from "../../src/agent/cli-runner.js";
import { spawnCapture } from "../../src/agent/cli-runner.js";
import { dockerRunArgs, resolveSpawnTarget } from "../../src/agent/docker-exec.js";
import { parseExecBackend, readFlowOptions } from "../../src/runtime/flow-options.js";

const IDS = { uid: 501, gid: 20 };
const BACKEND = { kind: "docker" as const, image: "img:test", sharedRoots: ["/Users/me"] };

describe("docker run 参数翻译（作者锁定）", () => {
  test("同路径挂载 worktree、宿主 uid:gid、只传变量名且排序、丢宿主专属变量、带 stdin 才加 -i", () => {
    const env = { PATH: "/usr/bin", HOME: "/Users/me", TMPDIR: "/tmp/x", DOCKER_HOST: "unix://x", OPENAI_API_KEY: "sk-secret", KUNPENG_IN_FLOW: "1", "BAD-NAME": "v" };
    const args = dockerRunArgs(BACKEND, "codex", ["exec", "--json"], "/Users/me/kunpeng/.kunpeng/wt/f1", env, true, IDS);
    expect(args).toEqual([
      "run", "--rm", "--init", "-i",
      "--user", "501:20",
      "-v", "/Users/me/kunpeng/.kunpeng/wt/f1:/Users/me/kunpeng/.kunpeng/wt/f1",
      "-w", "/Users/me/kunpeng/.kunpeng/wt/f1",
      "-e", "KUNPENG_IN_FLOW", "-e", "OPENAI_API_KEY",
      "img:test", "codex", "exec", "--json",
    ]);
    expect(args.join(" ")).not.toContain("sk-secret");
    expect(dockerRunArgs(BACKEND, "codex", [], "/Users/me/w", {}, false, IDS)).not.toContain("-i");
  });

  test("额外挂载原样透传", () => {
    const args = dockerRunArgs({ ...BACKEND, extraMounts: ["/Users/me/.codex:/home/u/.codex:ro"] }, "codex", [], "/Users/me/w", {}, false, IDS);
    expect(args).toContain("/Users/me/.codex:/home/u/.codex:ro");
  });

  test("工作目录不在共享根下 → 报错（容器内写入会静默丢失）", () => {
    expect(() => dockerRunArgs(BACKEND, "codex", [], "/private/tmp/w", {}, false, IDS)).toThrow(/共享根/);
    expect(() => dockerRunArgs(BACKEND, "codex", [], "/Users/meow/w", {}, false, IDS)).toThrow(/共享根/);
  });

  test("未配后端 → 原样执行", () => {
    expect(resolveSpawnTarget(undefined, "codex", ["a"], "/x", {}, true)).toEqual({ file: "codex", args: ["a"] });
  });
});

describe("flow-options 的 execBackend（作者锁定）", () => {
  test("合格配置解析；不合格给错误且不启用", () => {
    expect(parseExecBackend(undefined)).toEqual({});
    expect(parseExecBackend({ kind: "docker", image: "node:22" })).toEqual({ backend: { kind: "docker", image: "node:22" } });
    expect(parseExecBackend({ kind: "e2b", image: "x" }).error).toContain("docker");
    expect(parseExecBackend({ kind: "docker", image: "" }).error).toContain("image");
    expect(parseExecBackend({ kind: "docker", image: "x", sharedRoots: "/Users" }).error).toContain("sharedRoots");
  });

  test("readFlowOptions 带出 execBackend；坏的 execBackend 不影响 verifyEvaluator 且给出告警", () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-fo-exec-"));
    mkdirSync(join(repo, ".kunpeng"));
    writeFileSync(join(repo, ".kunpeng", "flow-options.json"), JSON.stringify({ verifyEvaluator: true, execBackend: { kind: "docker", image: "node:22" } }));
    expect(readFlowOptions(repo)).toEqual({ options: { verifyEvaluator: true, execBackend: { kind: "docker", image: "node:22" } } });
    writeFileSync(join(repo, ".kunpeng", "flow-options.json"), JSON.stringify({ verifyEvaluator: false, execBackend: { kind: "vm" } }));
    const bad = readFlowOptions(repo);
    expect(bad.options).toEqual({ verifyEvaluator: false });
    expect(bad.error).toContain("本机执行");
    rmSync(repo, { recursive: true, force: true });
  });

  test("createContext 把项目配置的 execBackend 交给 CliRunner（源码形状）", () => {
    const src = readFileSync(new URL("../../src/sdk/context.ts", import.meta.url), "utf8");
    expect(src).toContain("readFlowOptions(repoRoot)");
    expect(src).toMatch(/execBackend: flowOptions\.options\.execBackend/);
  });
});

describe("CliRunner 真的把 agent 命令改写成 docker run（作者锁定，PATH 上放假 docker）", () => {
  let root: string;
  let savedPath: string | undefined;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kp-fake-docker-"));
    mkdirSync(join(root, "bin"));
    mkdirSync(join(root, "wt"));
    const script = `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(root, "docker-args.txt")}"\nexit 0\n`;
    writeFileSync(join(root, "bin", "docker"), script);
    chmodSync(join(root, "bin", "docker"), 0o755);
    savedPath = process.env.PATH;
    process.env.PATH = `${join(root, "bin")}:${savedPath ?? ""}`;
  });
  afterEach(() => {
    process.env.PATH = savedPath;
    rmSync(root, { recursive: true, force: true });
  });

  test("codex 阶段调用经 docker run 发出，镜像与 worktree 挂载都在参数里；不走 seatbelt", async () => {
    const runner = new CliRunner({
      backend: "codex",
      availableBackends: new Set(["codex"]),
      healthPath: undefined, // 不读共享的 backend-health.json（别的测试会把 codex 标成宕）
      execBackend: { kind: "docker", image: "img:test", sharedRoots: [root] },
    });
    const failure = await runner.run({ stage: "implement", system: "", input: "改点东西", tools: [], cwd: join(root, "wt") })
      .then(() => undefined, (error: unknown) => error);
    const log = join(root, "docker-args.txt");
    expect(existsSync(log), `假 docker 没被调用；runner 错误：${String(failure)}`).toBe(true);
    const args = readFileSync(log, "utf8").trim().split("\n");
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "--init"]);
    expect(args).toContain("img:test");
    expect(args).toContain(`${join(root, "wt")}:${join(root, "wt")}`);
    const imageAt = args.indexOf("img:test");
    expect(args[imageAt + 1]).toBe("codex");
    expect(args).not.toContain("/usr/bin/sandbox-exec");
  });
});

function dockerUsable(): boolean {
  try {
    execFileSync("docker", ["image", "inspect", "node:22-bookworm"], { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!dockerUsable())("真容器端到端（本机有 docker 与 node:22-bookworm 时跑）", () => {
  test("cwd、宿主 uid、环境变量、stdin 都进容器，写回文件落在宿主", async () => {
    const dir = mkdtempSync(join(homedir(), ".kp-docker-accept-"));
    try {
      writeFileSync(join(dir, "in.txt"), "hello\n");
      const env = { ...process.env, KP_PROBE: "bar" } as Record<string, string>;
      const target = resolveSpawnTarget({ kind: "docker", image: "node:22-bookworm" }, "sh", ["-c", 'pwd; id -u; echo "KP_PROBE=$KP_PROBE"; cat in.txt; cat; echo out > made.txt'], dir, env, true);
      const out = await spawnCapture(target.file, target.args, dir, 120_000, env, "from-stdin\n", 120_000, true);
      expect(out.exitCode ?? 0).toBe(0);
      const lines = out.stdout.trim().split("\n");
      expect(lines[0]).toBe(dir);
      expect(lines[1]).toBe(String(process.getuid?.()));
      expect(lines).toContain("KP_PROBE=bar");
      expect(lines).toContain("hello");
      expect(lines).toContain("from-stdin");
      expect(readFileSync(join(dir, "made.txt"), "utf8").trim()).toBe("out");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});