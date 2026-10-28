import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { kunpengStateDir } from "../project/state-dir.js";
import { daemonPlatform } from "../runtime/daemon-schedule.js";
import {
  diffPublicSurface,
  extractPublicRoutes,
  formatGateDecision,
  parseHold,
  type PublicRoute,
} from "../runtime/deploy-gate.js";
import { renderServiceFiles, resolveCronRoot, resolveServeRoot, serviceLoadHint } from "../runtime/service-templates.js";
import { registerCliCommand, type CliContext } from "./registry.js";
import { valueAfter } from "./shared.js";

const USAGE = "用法: kunpeng deploy <status|hold|release|check> [--desc <原因>]";
const INSTALL_USAGE = "用法: kunpeng install --service [--port <1-65535>] [--serve-dir <目录>] [--cron-dir <目录>] [--tunnel <名称>] [--out <目录>]";
const ROUTES_ROOT = "orchestrator/src/server";

export function holdFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(kunpengStateDir(env), "deploy-hold.json");
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30_000,
  }).trim();
}

function routeSources(repoRoot: string, ref: string): Record<string, string> {
  const paths = git(repoRoot, ["ls-tree", "-r", "--name-only", ref, "--", ROUTES_ROOT])
    .split("\n")
    .filter((path) => path.endsWith(".ts"));
  const sources: Record<string, string> = {};
  for (const path of paths) sources[path] = git(repoRoot, ["show", `${ref}:${path}`]);
  return sources;
}

function readHold(path: string): ReturnType<typeof parseHold> {
  return parseHold(existsSync(path) ? readFileSync(path, "utf8") : null);
}

function deploymentState(context: CliContext): {
  onlineCommit: string;
  mainCommit: string;
  behind: number;
  added: PublicRoute[];
  decision: ReturnType<typeof formatGateDecision>;
} {
  const serveRoot = resolveServeRoot(process.env, homedir());
  const onlineCommit = git(serveRoot, ["rev-parse", "HEAD"]);
  const mainCommit = git(context.kunpengHome, ["rev-parse", "main"]);
  const behind = Number(git(context.kunpengHome, ["rev-list", "--count", `${onlineCommit}..${mainCommit}`]));
  if (!Number.isSafeInteger(behind) || behind < 0) throw new Error("无法计算线上落后 main 的提交数");

  const before = extractPublicRoutes(routeSources(serveRoot, "HEAD"));
  const after = extractPublicRoutes(routeSources(context.kunpengHome, "main"));
  const added = diffPublicSurface(before, after).added;
  const held = readHold(holdFilePath());
  return {
    onlineCommit,
    mainCommit,
    behind,
    added,
    decision: formatGateDecision({ held, behind, added }),
  };
}

function run(context: CliContext): void {
  const subcommand = context.rest[0];
  if (subcommand === undefined || context.rest.includes("--help") || context.rest.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }

  const holdPath = holdFilePath();
  if (subcommand === "hold") {
    const reason = context.descArg ?? valueAfter(context.rest, "--desc") ?? "未说明";
    mkdirSync(dirname(holdPath), { recursive: true });
    writeFileSync(holdPath, JSON.stringify({ held: true, reason, at: Date.now() }), "utf8");
    console.log(`部署闸已拦住：${reason}`);
    return;
  }
  if (subcommand === "release") {
    try {
      unlinkSync(holdPath);
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    console.log("部署闸已放行");
    return;
  }
  if (subcommand === "status" || subcommand === "check") {
    const state = deploymentState(context);
    if (subcommand === "status") {
      console.log(`线上 commit：${state.onlineCommit}`);
      console.log(`main commit：${state.mainCommit}`);
      for (const line of state.decision.lines) console.log(line);
      return;
    }
    const print = state.decision.allow ? console.log : console.error;
    for (const line of state.decision.lines) print(line);
    process.exit(state.decision.allow ? 0 : 1);
  }

  console.error(USAGE);
  process.exit(1);
}

registerCliCommand({ name: "deploy", run });

function install(context: CliContext): void {
  if (!context.rest.includes("--service")) {
    console.error(INSTALL_USAGE);
    process.exit(1);
  }
  const platform = daemonPlatform();
  if (platform === "unsupported") {
    console.error("服务文件仅支持 macOS launchd / Linux systemd");
    process.exit(1);
  }
  const portArg = valueAfter(context.rest, "--port");
  const port = Number(portArg ?? "7788");
  if ((context.rest.includes("--port") && portArg === undefined)
    || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`端口必须是 1–65535 的整数。${INSTALL_USAGE}`);
    process.exit(1);
  }
  const home = homedir();
  const stateDir = kunpengStateDir();
  const outDir = context.outArg ?? join(stateDir, "service-units");
  const files = renderServiceFiles(platform, {
    home, nodeBin: process.execPath, repoRoot: context.repoRoot,
    serveDir: valueAfter(context.rest, "--serve-dir") ?? resolveServeRoot(process.env, home),
    cronDir: valueAfter(context.rest, "--cron-dir") ?? resolveCronRoot(process.env, home),
    port, logDir: join(stateDir, "logs"), tunnel: valueAfter(context.rest, "--tunnel"),
  });
  mkdirSync(outDir, { recursive: true });
  for (const { file, content } of files) {
    const path = join(outDir, file);
    writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
    chmodSync(path, 0o600);
    console.log(path);
  }
  console.log(serviceLoadHint(platform, outDir, files));
}

registerCliCommand({ name: "install", usage: INSTALL_USAGE, run: install });
