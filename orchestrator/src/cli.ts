#!/usr/bin/env node
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveKunpengHome } from "./util/kunpeng-home.js";
import { realpathSync } from "node:fs";
import { resolveIdentity } from "./switchboard/identity.js";
import "./cli-commands/knowledge.js";
import "./cli-commands/library-skills.js";
import "./cli-commands/dossier-docs.js";
import "./cli-commands/spec-tools.js";
import "./cli-commands/reports.js";
import "./cli-commands/switchboard.js";
import "./cli-commands/project-admin.js";
import "./cli-commands/accounts.js";
import "./cli-commands/mcp.js";
import "./cli-commands/plugin.js";
import "./cli-commands/loop-yield-cmd.js";
import "./cli-commands/product.js";
import "./cli-commands/design.js";
import "./cli-commands/board-serve.js";
import "./cli-commands/ops.js";
import "./cli-commands/policy-cmd.js";
import "./cli-commands/duty.js";
import "./cli-commands/flywheel-eval.js";
import "./cli-commands/eval.js";
import "./cli-commands/maintain-guardian.js";
import "./cli-commands/devcycle.js";
import "./cli-commands/loop-core.js";
import "./cli-commands/worker.js";
import "./cli-commands/deploy.js";
import "./cli-commands/seo.js";
import "./cli-commands/goals.js";
import "./cli-commands/inbox-policy.js";
import "./cli-commands/acp.js";
import { dispatchCliCommand, listCliCommands } from "./cli-commands/registry.js";
import { beatPresence } from "./cli-commands/shared.js";
export { newSwitchMessages } from "./cli-commands/switchboard.js";
export { isProposalRouteTerminalStatus } from "./cli-commands/flywheel-eval.js";
export { planMaintainLessons } from "./cli-commands/maintain-guardian.js";
export { runScopeCheck, type ScopeCheckResult } from "./cli-commands/devcycle.js";
export { recordLoopWave } from "./cli-commands/loop-core.js";

import { makeFlowId } from "./util/flow-id.js";
import { resolveRepoRootFromCwd } from "./util/repo-root.js";
export { makeFlowId };

export const SELF_HELP_COMMANDS: ReadonlySet<string> = new Set(["worker", "deploy"]);

export function wantsHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

const PRIMARY_COMMAND_ORDER: readonly string[] =
  "命令: run | plan | product | merge | scope-check | gc | register | projects | capture | recall | promote | task | spec-lint | loop | loops | outbox | onboard | compile | asset-bundle | backend | savings | escape-rate | gate-stats | failures | lessons | pause | resume | guard | audit | evolve | distill-skill | skill | evaluate | patrol | ops | scout | apply | design-preview | design-codegen | board | board-watch | release | doc | snapshot | serve | worker | deploy | web2mcp | web2mcp-login | ai-repo-kit | spec-delta | burn-forecast | cost-report | weekly | solution | autopilot | maintain | status | flywheel | kb | best-of-n | workspace | codegraph | seo-mcp | dossier | inbox | reinject | pre-review | spec-index | mcp | plugin | loop-yield | goal | control-plane-audit | inbox-policy"
    .replace("projects | capture", "projects | account | version | upgrade | capture")
    .replace(/^命令:\s*/, "")
    .split(" | ");

/** 递归守卫：鲲鹏 loop 内的实现者 agent 严禁再派发 loop——指令自指递归会瞬间滚出大量幽灵流。
 *  命中条件：①KUNPENG_IN_FLOW 环境标记（CliRunner 给 agent 子进程打的）；②cwd 或目标仓库位于 flow worktree（.kunpeng/wt/）内。
 *  返回命中原因文本；未命中返回 undefined。只拦 run/plan（派发类命令），board/merge 等只读/收尾命令不拦。 */
export function recursionGuardReason(
  cmd: string | undefined, cwd: string, repoRoot: string, env: Record<string, string | undefined>,
): string | undefined {
  if (cmd !== "run" && cmd !== "plan") return undefined;
  if (env.KUNPENG_IN_FLOW) return "检测到 KUNPENG_IN_FLOW（你是 loop 内的 agent 子进程）";
  const marker = `${sep}.kunpeng${sep}wt${sep}`;
  if (cwd.includes(marker)) return `当前目录在 flow worktree 内（${cwd}）`;
  if (repoRoot.includes(marker)) return `目标仓库在 flow worktree 内（${repoRoot}）`;
  return undefined;
}

export function usageText(): string {
  const registered = listCliCommands().map((c) => c.name);
  const primary = PRIMARY_COMMAND_ORDER.filter((n) => registered.includes(n));
  const rest = registered.filter((n) => !PRIMARY_COMMAND_ORDER.includes(n)).sort();
  return `命令: ${[...primary, ...rest].join(" | ")}`;
}

export function helpOutput(argv: string[]): string {
  const name = firstCommand(argv);
  return listCliCommands().find((command) => command.name === name)?.usage ?? usageText();
}

async function main() {
  const argv = process.argv.slice(2);
  if (wantsHelp(argv) && !SELF_HELP_COMMANDS.has(firstCommand(argv) ?? "")) {
    console.log(helpOutput(argv));
    return;
  }
  const firstCmd = firstCommand(argv);
  // --repo <path>：要操作的【目标项目仓库】（桥接的真项目）。默认 KUNPENG_REPO 或当前目录。
  let repoArg: string | undefined;
  let acceptArg: string | undefined;
  let nameArg: string | undefined;
  let concurrencyArg: string | undefined;
  let goalArg: string | undefined;
  let intervalArg: string | undefined;
  let sourcesArg: string | undefined;
  let outArg: string | undefined;
  let authArg: string | undefined;
  let discoverArg: string | undefined;
  let maxActionsArg: string | undefined;
  let descArg: string | undefined;
  let limitArg: string | undefined;
  let topicArg: string | undefined;
  let pageArg: string | undefined;
  const flags = new Set<string>();  // 布尔开关：--research / --install / --uninstall / --print-cron
  const parsed: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const keepNameForSolutionApply = firstCmd === "solution" && parsed[0] === "solution" && parsed[1] === "apply";
    if (argv[i] === "--repo") { repoArg = argv[++i]; }
    else if (argv[i] === "--days" && (firstCmd === "failures" || firstCmd === "weekly")) { i++; }
    else if (argv[i] === "--accept") { acceptArg = argv[++i]; }  // 方案带来的精确验收命令（P1）
    else if (argv[i] === "--name" && firstCmd !== "loop" && !keepNameForSolutionApply) { nameArg = argv[++i]; }
    else if (argv[i] === "--concurrency") { concurrencyArg = argv[++i]; }  // plan 段内并发上限
    else if (argv[i] === "--goal") { goalArg = argv[++i]; }
    else if (argv[i] === "--interval") { intervalArg = argv[++i]; }  // patrol 调度间隔（秒）
    else if (argv[i] === "--sources") { sourcesArg = argv[++i]; }  // design-preview 候选来源池
    else if (argv[i] === "--out") { outArg = argv[++i]; }  // web2mcp 生成工程输出目录
    else if (argv[i] === "--auth") { authArg = argv[++i]; }  // web2mcp storageState 路径
    else if (argv[i] === "--discover") { discoverArg = argv[++i]; }  // web2mcp: form|network|both
    else if (argv[i] === "--max-actions") { maxActionsArg = argv[++i]; }  // web2mcp 动作上限
    else if (argv[i] === "--desc") { descArg = argv[++i]; }
    else if (argv[i] === "--limit") { limitArg = argv[++i]; }
    else if (argv[i] === "--topic") { topicArg = argv[++i]; }  // scout 研究主题（覆盖自动推断）
    else if (argv[i] === "--page") { pageArg = argv[++i]; }
    else if (["--research", "--install", "--uninstall", "--print-cron", "--dry-run", "--enrich", "--adaptive", "--mixed", "--persist", "--urgent", "--all", "--all-projects", "--fix", "--strict"].includes(argv[i])) { flags.add(argv[i]); }
    else parsed.push(argv[i]);
  }
  const [cmd, ...rest] = parsed;
  const explicitRepo = repoArg ?? process.env.KUNPENG_REPO;
  const repoRoot = explicitRepo ? resolve(explicitRepo) : resolveRepoRootFromCwd(process.cwd());
  // 递归守卫（硬闸门）：flow 内部禁止再派发 run/plan。loop 的实现者应直接改文件，而不是把活儿递归派回鲲鹏。
  const guardHit = recursionGuardReason(cmd, process.cwd(), repoRoot, process.env);
  if (guardHit) {
    console.error(`[递归守卫] 拒绝 ${cmd}：${guardHit}。你已在鲲鹏 loop 内部——请直接创建/修改文件完成任务，不要调用 kunpeng CLI 再派发。`);
    process.exit(3);
  }
  // 鲲鹏 HOME：宪法/角色卡所在（编译 AGENTS.md 的源），与目标仓库解耦。默认安装目录上层。
  const kunpengHome = resolveKunpengHome();

  await beatPresence(resolveIdentity({ env: process.env.KUNPENG_INSTANCE, cwd: process.cwd() }));

  if (cmd && (await dispatchCliCommand(cmd, { repoRoot, kunpengHome, rest, argv, flags, repoArg, acceptArg, nameArg, concurrencyArg, goalArg, intervalArg, sourcesArg, outArg, authArg, discoverArg, maxActionsArg, descArg, limitArg, topicArg, pageArg }))) return;
  console.error(usageText());
  process.exit(1);
}

function firstCommand(argv: string[]): string | undefined {
  const valueFlags = new Set(["--repo", "--accept", "--name", "--concurrency", "--goal", "--interval", "--sources", "--out", "--auth", "--discover", "--max-actions", "--desc", "--limit", "--configs", "--days"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) return arg;
    if (valueFlags.has(arg)) i++;
  }
  return undefined;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
