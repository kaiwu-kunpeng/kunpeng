import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRequest, AgentResult, AgentRunner, Stage } from "./runner.js";
import { scheduledRoute } from "./model-routing.js";
import { detectBackends, resolveBackend, SAME_BACKEND_NOTICE, type BackendProbe } from "./backend-routing.js";
import type { Account } from "./account-pool.js";
import { expandEnv, pickAccount, sanitizeAccountEnv } from "./account-pool.js";
import { QuotaTracker, saveQuota } from "./quota-tracker.js";
import { extractTokensUsed } from "../util/extract-tokens.js";
import { effectiveBilledTokens } from "../runtime/billed-tokens.js";
import { ensureFlowTmpDir } from "../runtime/flow-tmp.js";
import { getAdapter, type BackendAdapter } from "./backend-adapter.js";
import { collectToolchainWritableRoots } from "./toolchain-roots.js";
import { resolveSpawnTarget, type ExecBackendConfig } from "./docker-exec.js";
import { spawnStream } from "./cli-stream.js";
import { parseClaudeStreamLine, parseCodexStreamLine, parseCodexThreadId, type StreamDelta } from "./cli-stream-parse.js";
import { resolveActiveProfile, sharedDir, type ActiveProfile } from "../project/profile.js";
import { buildFlowEnv } from "../project/profile-env-builder.js";
import { writeProfileMcpConfig, type McpConfig } from "../project/mcp-generator.js";
import { classifyCliFailure, isBackendDownKind, isModelDownKind, retryDelayMs } from "./error-classify.js";
import { backendHealthPath, downBackends, downModels, EMPTY_RESPONSE_TTL_MS, loadBackendHealth, markBackendDown, markModelDown, nextModel, resolveBackendDownTtlMs } from "./backend-health.js";
import { buildSandboxProfile, collectWriteScopes, governanceDenyPaths, sandboxAvailable, wrapWithSandbox } from "./sandbox-wrap.js";
import { countSandboxDenials, sandboxDecision } from "./sandbox-signal.js";
import { unattendedIsolationRefusal } from "./unattended-isolation.js";
import { loadStageMethodology } from "./stage-methodology.js";
import { parseTestCmdLine } from "./testcmd.js";

export const DEFAULT_TIMEOUT_MS = 600_000; // 10min：任何后端调用超时即杀子进程并报错，绝不无限挂死
export const DEFAULT_IDLE_TIMEOUT_MS = 600_000; // 10min：>5 分钟无输出的工具调用不能被误杀
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = DEFAULT_IDLE_TIMEOUT_MS;
const CLI_FAILURE_TAIL_CHARS = 2_000;

function failureTail(text: string): string {
  return text.slice(-CLI_FAILURE_TAIL_CHARS);
}

declare module "./runner.js" {
  interface AgentRequest {
    profileId?: string;
  }
}

// 起子 CLI：stdin 设为 ignore(/dev/null) 让子进程立刻拿到 EOF——
// 否则 codex exec 会把开着的 stdin 管道当作"等待输入"而无限阻塞（0% CPU 睡死）。
// 带超时：到点 SIGKILL 子进程并 reject——把 codex 那次挂死的教训固化成硬保护。
export function spawnCapture(
  file: string, args: string[], cwd: string, timeoutMs = DEFAULT_TIMEOUT_MS, env?: Record<string, string>,
  stdinInput?: string, idleTimeoutMs?: number, replaceEnv = false,
): Promise<{ stdout: string; stderr: string; exitCode?: number | null }> {
  return new Promise((resolve, reject) => {
    // prompt 走 stdin（非 argv）：大 prompt（如某阶段输出上 MB）作为命令行参数会撞 ARG_MAX 抛 spawn E2BIG；
    // stdin 无此限制。写完即 end（给 EOF），避免 codex exec 把开着的 stdin 当"等待输入"而睡死。
    const child = spawn(file, args, {
      cwd,
      stdio: [stdinInput !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      ...(replaceEnv ? { env: env ?? {} } : env ? { env: { ...process.env, ...env } } : {}),
    });
    if (stdinInput !== undefined && child.stdin) {
      child.stdin.on("error", () => { /* 子进程提前退出导致的 EPIPE：忽略，错误由 close/error 反映 */ });
      child.stdin.write(stdinInput);
      child.stdin.end();
    }
    let stdout = "", stderr = "", done = false;
    let idleTimer: NodeJS.Timeout | undefined;
    const settle = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() => reject(new Error(`后端调用超时 ${timeoutMs}ms，已杀进程: ${file} ${args[0] ?? ""}`)));
    }, timeoutMs);
    let hasOutput = false;
    const refreshIdleTimer = () => {
      if (idleTimeoutMs === undefined) return;
      if (idleTimer) clearTimeout(idleTimer);
      const idleDelayMs = hasOutput ? idleTimeoutMs : Math.min(timeoutMs, Math.max(idleTimeoutMs, 250));
      idleTimer = setTimeout(() => {
        child.kill("SIGKILL");
        settle(() => reject(new Error(`后端调用空闲超时 ${idleTimeoutMs}ms，已杀进程: ${file} ${args[0] ?? ""}`)));
      }, idleDelayMs);
    };
    refreshIdleTimer();
    child.stdout!.on("data", (d) => { hasOutput = true; refreshIdleTimer(); stdout += d; });
    child.stderr!.on("data", (d) => { hasOutput = true; refreshIdleTimer(); stderr += d; });
    child.on("error", (e) => settle(() => reject(e)));
    child.on("close", (exitCode) => settle(() => resolve({ stdout, stderr, exitCode })));
  });
}

export type Backend = "claude" | "codex";
type ResolveProfileFn = (id: string) => ActiveProfile;
interface ExecResult { stdout: string; stderr: string; exitCode?: number | null; }
type ExecFn = (file: string, args: string[], cwd: string, env?: Record<string, string>, stdinInput?: string) => Promise<ExecResult>;
type RetryWaitFn = (delayMs: number) => Promise<void>;
export type StreamExecFn = (
  file: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
  env?: Record<string, string>,
  stdinInput?: string,
  idleTimeoutMs?: number,
  signal?: AbortSignal,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
export interface StageRoute { model?: string; effort?: string; }
export interface CliRunnerOpts {
  backend?: Backend;
  backendRouting?: Partial<Record<Stage, Backend>>;
  exec?: ExecFn;
  streamExec?: StreamExecFn;
  /** 执行后端：缺省本机；docker 时 agent 进程跑在本机容器里（见 docker-exec.ts）。只作用于默认 exec/streamExec。 */
  execBackend?: ExecBackendConfig;
  /** 运行平台（默认 process.platform）；非 darwin 时 implement 阶段需写入围栏，见 unattended-isolation.ts。 */
  platform?: string;
  /** 每阶段模型/effort 路由（Token T3）：轻活低档、关键活高档——为省 token。 */
  route?: Partial<Record<Stage, StageRoute>>;
  /** 单次后端调用超时（ms），到点杀进程报错。默认 10min。 */
  timeoutMs?: number;
  /** 单次后端调用空闲超时（ms），长时间无 stdout/stderr 即杀进程；默认 10min。 */
  idleTimeoutMs?: number;
  /** 配额追踪（P3）：每次后端调用记一笔 (backend, model/effort)，喂总控台。 */
  quota?: QuotaTracker;
  /** 可选账号池：若存在则每次运行前通过 pickAccount 选择，注入其环境变量。 */
  accounts?: Account[];
  /** 可选配额文件路径：若设置则运行后将 quota 状态持久化到此文件。 */
  quotaPath?: string;
  healthPath?: string;
  emptyResponseIsFailure?: boolean;
  /** 测试注入：覆盖 CLI 可用性探测。生产默认用 which。 */
  backendProbe?: BackendProbe;
  /** 测试注入：直接给定可用后端集合，跳过探测。 */
  availableBackends?: Set<Backend>;
  /** 测试注入：覆盖 profile 解析，生产默认读取当前 KUNPENG_STATE。 */
  resolveProfile?: ResolveProfileFn;
  /** 可选重试事件接收器；未提供时写入 stderr，保证退避行为可见。 */
  onEvent?: (message: string) => void;
  /** 测试注入：覆盖退避等待。 */
  retryWait?: RetryWaitFn;
}

const scopeGuardPath = fileURLToPath(new URL("../../scripts/pretooluse-scope-guard.cjs", import.meta.url));
const bashShieldPath = fileURLToPath(new URL("../../scripts/pretooluse-bash-shield.cjs", import.meta.url));

export function configureScopeGuard(
  req: AgentRequest,
  backend: Backend,
  args: string[],
  env?: Record<string, string>,
  hookScripts: { scopeGuard: string; bashShield: string } = { scopeGuard: scopeGuardPath, bashShield: bashShieldPath },
): { args: string[]; env?: Record<string, string> } {
  const scopeAllow = req.scopeAllow ?? [];
  const hostDeny = req.hostDeny ?? [];
  if (backend !== "claude" || !req.cwd || (!scopeAllow.length && !hostDeny.length)) return { args, env };

  if (scopeAllow.length) {
    for (const path of [hookScripts.scopeGuard, hookScripts.bashShield]) {
      if (!existsSync(path)) throw new Error(`scope-guard fail-closed: hook 脚本缺失 ${path}`);
    }
  }

  try {
    const settingsPath = resolve(req.cwd, ".kunpeng", "scope-guard-settings.json");
    mkdirSync(resolve(req.cwd, ".kunpeng"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      ...(scopeAllow.length ? { hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit|MultiEdit|NotebookEdit",
            hooks: [{ type: "command", command: `node ${hookScripts.scopeGuard}` }],
          },
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: `node ${hookScripts.bashShield}` }],
          },
        ],
      } } : {}),
      ...(hostDeny.length ? { permissions: { deny: [...new Set(hostDeny)].sort() } } : {}),
    }), "utf8");
    return {
      args: [...args, "--settings", settingsPath],
      env: scopeAllow.length ? { ...(env ?? {}), KP_SCOPE_ALLOW: scopeAllow.join(",") } : env,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`scope-guard fail-closed: 写入 hook 配置失败: ${message}`, { cause: error });
  }
}

// 模型分层路由迁到 model-routing.ts（P3，backend-aware：claude 走实际模型，
// codex 走 model+effort 档），此处不再本地维护 DEFAULT_ROUTE。

function modelUsedLabel(route: StageRoute): string | undefined {
  return route.model && route.effort ? `${route.model}@${route.effort}` : (route.model ?? route.effort);
}

/** 按后端解析输出为 {正文, token 数}。
 *  claude(--output-format json):取 result 当正文、usage.input_tokens+output_tokens 当 token;
 *    解析失败(未登录/非json)回退到文本+extractTokensUsed(不丢健壮性)。
 *  codex:stdout+stderr 文本 + extractTokensUsed(沿用 `tokens used N` 横幅)。 */
export function parseBackendOutput(backend: Backend, stdout: string, stderr: string): { text: string; tokens?: number } {
  if (backend === "claude") {
    try {
      const j = JSON.parse(stdout) as {
        result?: unknown;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      };
      if (typeof j.result === "string") {
        const tokens = effectiveBilledTokens({
          input: j.usage?.input_tokens,
          output: j.usage?.output_tokens,
          cacheCreate: j.usage?.cache_creation_input_tokens,
          cacheRead: j.usage?.cache_read_input_tokens,
        });
        return { text: j.result, tokens: tokens > 0 ? tokens : undefined };
      }
    } catch { /* 非 json → 回退 */ }
  }
  const text = `${stdout}${stderr}`;
  return { text, tokens: extractTokensUsed(text) };
}

export class CliRunner implements AgentRunner {
  readonly backend: Backend;      // 主/标签后端(=forced ?? claude)；实际每 stage 由 resolveBackend 决定
  private forced?: Backend;        // 显式 KUNPENG_BACKEND/opts.backend → 强制单后端；未设=混合(P3b)
  private backendRouting?: Partial<Record<Stage, Backend>>;
  private exec: ExecFn;
  private streamExec: StreamExecFn;
  private readonly execBackend?: ExecBackendConfig;
  private readonly platform: string;
  private pendingOnSpawn?: (pid: number) => void;
  private route: Partial<Record<Stage, StageRoute>>;
  private idleTimeoutMs?: number;
  private streamIdleTimeoutMs: number;
  private quota?: QuotaTracker;
  private accounts?: Account[];
  private quotaPath?: string;
  private backendProbe?: BackendProbe;
  private available?: Set<Backend>;
  private resolveProfile: ResolveProfileFn;
  private onEvent?: (message: string) => void;
  private retryWait: RetryWaitFn;
  private down = new Set<Backend>();
  private modelsDown = new Map<Backend, Set<string>>();
  private healthPath?: string;
  private emptyResponseIsFailure: boolean;
  constructor(opts: CliRunnerOpts = {}) {
    this.forced = opts.backend ?? (process.env.KUNPENG_BACKEND as Backend | undefined);
    this.backend = this.forced ?? "claude";
    this.backendRouting = opts.backendRouting;
    this.route = opts.route ?? {};
    this.quota = opts.quota;
    this.accounts = opts.accounts;
    this.quotaPath = opts.quotaPath;
    const injected = opts.exec !== undefined || opts.streamExec !== undefined;
    this.healthPath = "healthPath" in opts ? opts.healthPath
      : injected ? undefined : backendHealthPath(join(process.env.KUNPENG_REPO ?? process.cwd(), ".kunpeng"));
    this.emptyResponseIsFailure = opts.emptyResponseIsFailure ?? !injected;
    this.backendProbe = opts.backendProbe;
    this.resolveProfile = opts.resolveProfile ?? resolveActiveProfile;
    this.onEvent = opts.onEvent;
    this.retryWait = opts.retryWait ?? ((delayMs) => new Promise((resolveWait) => setTimeout(resolveWait, delayMs)));
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.streamIdleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
    // Unit tests commonly inject exec without real CLIs installed. Treat that as a fully mocked backend surface
    // unless the test explicitly provides a probe or availability set.
    this.available = opts.availableBackends ?? (opts.exec && !opts.backendProbe
      ? new Set<Backend>(["claude", "codex"])
      : undefined);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // 递归守卫标记：loop 的 agent 子进程(及其派生的一切 shell)带上 KUNPENG_IN_FLOW，
    // 新版 cli 见此标记即拒绝 run/plan——防实现者把任务再递归派发回鲲鹏(指令自指递归)。
    // 只在这里打标(agent 运行器)，不动通用 spawn 层：cockpit 聊天/终端是用户合法派发入口。
    const stamped = (env?: Record<string, string>): Record<string, string> => ({ ...(env ?? {}), KUNPENG_IN_FLOW: "1" });
    this.execBackend = opts.execBackend;
    this.platform = opts.platform ?? process.platform;
    this.exec = opts.exec ?? ((file, args, cwd, env, stdinInput) => {
      const target = resolveSpawnTarget(this.execBackend, file, args, cwd, stamped(env), stdinInput !== undefined);
      return spawnCapture(target.file, target.args, cwd, timeoutMs, stamped(env), stdinInput, this.idleTimeoutMs, true);
    });
    this.streamExec = opts.streamExec ?? ((file, args, cwd, onLine, env, stdinInput, idleTimeoutMs, signal) => {
      const target = resolveSpawnTarget(this.execBackend, file, args, cwd, stamped(env), stdinInput !== undefined);
      return spawnStream(
        target.file,
        target.args,
        cwd,
        onLine,
        { timeoutMs, idleTimeoutMs, env: stamped(env), replaceEnv: true, stdinInput, signal, onSpawn: this.pendingOnSpawn },
      );
    });
  }

  buildPrompt(req: AgentRequest): string {
    // instructionOverride 非空 → 整段替换 stage 角色指令并省掉 `# Stage:` 行（研究等非流水线调用），
    // 避免 stage="spec" 的「写 spec」指令劫持联网调研（无 TESTCMD、无 stage 痕迹）。空串退化为常规分支。
    if (req.instructionOverride) {
      return [req.system, req.instructionOverride, "# Input", req.input].filter(Boolean).join("\n\n");
    }
    const instruction =
      req.stage === "spec"
        ? loadStageMethodology("plan", this.backend)
        : req.stage === "implement"
          ? loadStageMethodology("implement", this.backend)
          : `只完成本 stage 的短距离目标，输出结果文本即可（C9）。`;
    return [req.system, `# Stage: ${req.stage}`, instruction, `# Input`, req.input]
      .filter(Boolean).join("\n\n");
  }

  private async availableBackends(): Promise<Set<Backend>> {
    if (!this.available) {
      this.available = await detectBackends(this.backendProbe);
    }
    return this.available;
  }

  private noBackendMessage(): string {
    const available = [...this.available ?? []].join("/") || "-";
    const down = [...this.down].join("/") || "-";
    return `[backend-down] 无可用后端（codex/claude 均不可用）：已检测 ${available}；已标不可用 ${down}`
      + (this.healthPath ? `；详情见 ${this.healthPath}` : "");
  }

  private syncHealth(now: number): void {
    if (!this.healthPath) return;
    const file = loadBackendHealth(this.healthPath, now);
    const down = downBackends(file, now);
    for (const backend of ["claude", "codex"] as const) {
      if (down.has(backend)) this.down.add(backend);
      this.modelsDown.set(backend, new Set([...this.modelsDown.get(backend) ?? [], ...downModels(file, backend, now)]));
    }
  }

  private markDown(backend: Backend, kind: string, reason: string, ttlMs?: number): void {
    this.down.add(backend);
    if (this.healthPath) {
      markBackendDown(this.healthPath, backend, {
        kind, reason, ttlMs: ttlMs ?? resolveBackendDownTtlMs(process.env), now: Date.now(),
      });
    }
  }

  private markModel(backend: Backend, model: string, kind: string, reason: string): void {
    const down = this.modelsDown.get(backend) ?? new Set<string>();
    down.add(model);
    this.modelsDown.set(backend, down);
    if (this.healthPath) {
      markModelDown(this.healthPath, backend, model, {
        kind, reason, ttlMs: resolveBackendDownTtlMs(process.env), now: Date.now(),
      });
    }
  }

  private resolveRoute(req: AgentRequest, backend: Backend): StageRoute | null {
    const route: StageRoute = {
      ...scheduledRoute(req.stage, backend, process.env),
      ...this.route[req.stage],
      ...(req.model ? { model: req.model } : {}),
    };
    const down = this.modelsDown.get(backend);
    if (down?.has(route.model ?? "default")) {
      route.model = nextModel(backend, route.model, down);
      if (route.model === undefined) {
        this.down.add(backend);
        return null;
      }
    }
    return route;
  }

  private isUnavailableError(e: unknown): boolean {
    if (!e || typeof e !== "object") return false;
    const maybe = e as { code?: unknown; message?: unknown; stderr?: unknown };
    if (maybe.code === "ENOENT") return true;
    const text = [maybe.message, maybe.stderr].filter((v): v is string => typeof v === "string").join("\n");
    return this.isUnavailableText(text);
  }

  private isUnavailableText(text: string): boolean {
    return /not logged in|please run \/login|login required|authentication required|auth(?:entication)? failed/i.test(text);
  }

  private isUnavailableResultText(text: string): boolean {
    const normalized = text
      .replace(/\s+/g, " ")
      .trim();
    return /^(?:error:?\s*)?(?:not logged in(?:\s*[·.:-]\s*please run \/login)?|please run \/login|login required|authentication required|auth(?:entication)? failed)$/i.test(normalized);
  }

  private noteSameBackend(req: AgentRequest, backend: Backend, noted: { done: boolean }): void {
    if (req.avoidBackend === undefined || backend !== req.avoidBackend || noted.done) return;
    noted.done = true;
    if (this.onEvent) this.onEvent(SAME_BACKEND_NOTICE);
    else process.stderr.write(SAME_BACKEND_NOTICE + "\n");
  }

  private async waitForRetry(attempt: number, reason: string): Promise<void> {
    const message = `[retry] 第${attempt}次重试(原因: ${reason})`;
    if (this.onEvent) this.onEvent(message);
    else process.stderr.write(`${message}\n`);
    await this.retryWait(retryDelayMs(attempt));
  }

  private profileContext(req: AgentRequest, baseEnv: Record<string, string> | undefined, adapter: BackendAdapter): { env: Record<string, string>; mcpConfigPath?: string } {
    const profile = req.profileId ? this.resolveProfile(req.profileId) : undefined;
    return {
      env: buildFlowEnv({
        baseEnv: { ...process.env, ...(baseEnv ?? {}), ...(req.cwd ? { TMPDIR: ensureFlowTmpDir(req.cwd) } : {}) },
        allowKeys: [...adapter.authEnv, ...Object.keys(baseEnv ?? {})],
        ...(profile ? { profile } : {}),
      }),
      mcpConfigPath: profile && existsSync(profile.mcpConfigPath) ? profile.mcpConfigPath : undefined,
    };
  }

  /** profile mcp.json 惰性生成:共享模板 ~/.kunpeng/shared/mcp-base.json 存在且 profile 的 mcp.json 尚未生成时,
   *  把托管凭据注入模板落盘(幂等:已存在不覆盖)。无模板=行为不变(不写空配置,避免 --strict-mcp-config 禁掉用户全部 MCP)。 */
  private async ensureProfileMcp(profileId: string | undefined): Promise<void> {
    if (!profileId) return;
    try {
      const profile = this.resolveProfile(profileId);
      if (existsSync(profile.mcpConfigPath)) return;
      const basePath = join(sharedDir(), "mcp-base.json");
      if (!existsSync(basePath)) return;
      const base = JSON.parse(readFileSync(basePath, "utf8")) as McpConfig;
      await writeProfileMcpConfig(profile, base);
    } catch {
      // 生成失败不得阻断运行:悬空守卫会让本次退回无 mcp 配置。
    }
  }

  /** 非 macOS 上无写入围栏的 implement 一律在 spawn 前拒绝（fail-closed，R05a）。 */
  private assertIsolation(req: AgentRequest, backend: Backend): void {
    const refusal = unattendedIsolationRefusal({
      platform: this.platform,
      stage: req.stage,
      backend,
      hasExecBackend: this.execBackend !== undefined,
      allowUnsandboxed: process.env.KUNPENG_ALLOW_UNSANDBOXED,
    });
    if (refusal) throw new Error(refusal);
  }

  /** seatbelt 文件系统围栏（默认关闭/opt-in，KUNPENG_SANDBOX=1 才生效；codex 后端因 app-server
   *  与 seatbelt 冲突起不来，一律跳过——它本就带 --sandbox workspace-write）：把 spawn 包进 sandbox-exec。
   *  整个函数不得抛——任何前置条件不满足或异常一律原样返回（fail-safe，绝不挡自建流）。
   *  判定结果写入 stderr，便于确认本次是否实际套上围栏。 */
  private applySandbox(
    file: string,
    args: string[],
    cwd: string | undefined,
    req: AgentRequest,
    backend: Backend,
  ): { file: string; args: string[] } {
    if (this.execBackend) {
      console.error(`[sandbox] ${this.execBackend.kind} 执行后端由容器隔离，跳过 seatbelt`);
      return { file, args };
    }
    try {
      const decision = sandboxDecision({
        envValue: process.env.KUNPENG_SANDBOX,
        backend,
        cwd,
        scopeAllowCount: req.scopeAllow?.length ?? 0,
        available: sandboxAvailable(),
      });
      console.error(`[sandbox] ${decision.reason}`);
      if (!decision.engaged) return { file, args };
      const sandboxCwd = cwd as string;
      const scopes = collectWriteScopes(sandboxCwd, [ensureFlowTmpDir(sandboxCwd)]);
      const profile = buildSandboxProfile(scopes, governanceDenyPaths(sandboxCwd));
      const profilePath = join(sandboxCwd, ".kunpeng", "agent-sandbox.sb");
      mkdirSync(join(sandboxCwd, ".kunpeng"), { recursive: true });
      writeFileSync(profilePath, profile, "utf8");
      return wrapWithSandbox(file, args, profilePath);
    } catch {
      return { file, args };
    }
  }

  async runStreaming(req: AgentRequest, onDelta: (d: StreamDelta) => void): Promise<AgentResult> {
    this.syncHealth(Date.now());
    const cwd = req.cwd ?? process.cwd();
    const available = await this.availableBackends();
    let attemptedFallback = false;
    const chain: string[] = [];

    const sameNoted = { done: false };
    backendAttempts: for (let attempt = 0; attempt < 6;) {
      const resolved = resolveBackend(req.stage, {
        forced: this.forced,
        routing: this.backendRouting,
        available,
        down: this.down,
        ...(req.avoidBackend !== undefined ? { avoid: req.avoidBackend } : {}),
      });
      if (!resolved) throw new Error(this.noBackendMessage());
      const { backend, fellBack } = resolved;
      this.noteSameBackend(req, backend, sameNoted);
      const route = this.resolveRoute(req, backend);
      if (!route) {
        attemptedFallback = true;
        continue backendAttempts;
      }
      attempt++;
      chain.push(`${backend}:${route.model ?? "default"}`);
      const now = Date.now();
      const modelUsed = modelUsedLabel(route);
      const model = modelUsed ?? "default";
      const selectedAccount = this.accounts?.length
        ? pickAccount(this.accounts, this.quota ?? new QuotaTracker(), now, backend)
        : undefined;

      const adapter = getAdapter(backend);
      if (!adapter) throw new Error(`无此后端 adapter: ${backend}`);
      const accountEnv = selectedAccount?.env ? sanitizeAccountEnv(expandEnv(selectedAccount.env)) : undefined;
      await this.ensureProfileMcp(req.profileId);
      const profile = this.profileContext(req, accountEnv, adapter);
      const invRoute = backend === "codex" ? { ...route, writableRoots: collectToolchainWritableRoots(cwd) } : route;
      const inv = adapter.invokeStream?.(invRoute, req.tools ?? [], profile.mcpConfigPath) ?? adapter.invoke(invRoute, req.tools ?? [], profile.mcpConfigPath);
      const prompt = this.buildPrompt(req);
      const file = inv.bin;
      const args = inv.promptVia === "argv" ? [...inv.args, prompt] : inv.args;
      const stdinInput = inv.promptVia === "stdin" ? prompt : undefined;
      const parse = backend === "codex" ? parseCodexStreamLine : parseClaudeStreamLine;
      const guarded = configureScopeGuard(req, backend, args, profile.env);
      this.assertIsolation(req, backend);
      const sb = this.applySandbox(file, guarded.args, cwd, req, backend);

      for (let cliAttempt = 1; cliAttempt <= 3; cliAttempt++) {
        let finalText = "";
        let usage: StreamDelta["usage"];
        let execution: Awaited<ReturnType<StreamExecFn>>;
        this.pendingOnSpawn = req.onSpawn;
        try {
          execution = await this.streamExec(sb.file, sb.args, cwd, (line) => {
            if (backend === "codex") {
              const threadId = parseCodexThreadId(line);
              if (threadId) onDelta({ sessionId: threadId });
            }
            const delta = parse(line);
            if (!delta) return;
            onDelta(delta);
            if (delta.final !== undefined) {
              finalText = delta.final;
            } else if (delta.text !== undefined) {
              finalText += delta.text;
            }
            if (delta.usage !== undefined) usage = delta.usage;
          }, guarded.env, stdinInput, this.streamIdleTimeoutMs, req.signal);
        } catch (e) {
          if (this.isUnavailableError(e)) {
            this.markDown(backend, "auth", e instanceof Error ? e.message : String(e));
            attemptedFallback = true;
            continue backendAttempts;
          }
          const detail = e && typeof e === "object"
            ? e as { code?: unknown; exitCode?: unknown; message?: unknown; stderr?: unknown; stdout?: unknown }
            : undefined;
          const exitCode = typeof detail?.exitCode === "number" || detail?.exitCode === null
            ? detail.exitCode : 1;
          const stderrTail = failureTail(typeof detail?.stderr === "string" ? detail.stderr : "");
          const streamTail = failureTail([
            typeof detail?.message === "string" ? detail.message : String(e),
            typeof detail?.code === "string" ? detail.code : "",
            typeof detail?.stdout === "string" ? detail.stdout : "",
          ].filter(Boolean).join("\n"));
          const failure = classifyCliFailure(exitCode, stderrTail, streamTail);
          if (isBackendDownKind(failure.kind)) {
            this.markDown(backend, failure.kind, failure.reason);
            attemptedFallback = true;
            continue backendAttempts;
          }
          if (isModelDownKind(failure.kind)) {
            this.markModel(backend, route.model ?? "default", failure.kind, failure.reason);
            attemptedFallback = true;
            continue backendAttempts;
          }
          if (failure.transient && cliAttempt < 3) {
            await this.waitForRetry(cliAttempt, failure.reason);
            continue;
          }
          throw e;
        } finally {
          this.pendingOnSpawn = undefined;
        }

        const tokens = (usage?.input ?? 0) + (usage?.output ?? 0);
        if (this.emptyResponseIsFailure && execution.exitCode === 0 && finalText.trim() === "" && tokens === 0) {
          this.markDown(backend, "empty-response", "退出码 0 但无正文且零 token", EMPTY_RESPONSE_TTL_MS);
          attemptedFallback = true;
          continue backendAttempts;
        }

        if (selectedAccount) {
          this.quota?.record(selectedAccount.id, model, now);
        } else {
          this.quota?.record(backend, model);
        }
        if (this.quotaPath && this.quota) await saveQuota(this.quotaPath, this.quota);

        const testCmd = parseTestCmdLine(finalText);
        const sandboxDenials = backend === "codex" ? countSandboxDenials(execution.stdout) : 0;
        if (sandboxDenials > 0) console.warn(`[cli-runner] codex 沙箱拒绝 ${sandboxDenials} 次（Operation not permitted）`);
        return {
          text: finalText,
          meta: {
            ...(testCmd ? { testCmd } : {}),
            ...(tokens > 0 ? { tokens } : {}),
            ...(sandboxDenials > 0 ? { sandboxDenials } : {}),
          },
          backend,
          fellBack: attemptedFallback || fellBack,
          modelUsed,
          chain,
        };
      }
    }
    throw new Error(this.noBackendMessage());
  }

  async run(req: AgentRequest): Promise<AgentResult> {
    this.syncHealth(Date.now());
    const cwd = req.cwd ?? process.cwd();
    const available = await this.availableBackends();
    let attemptedFallback = false;
    let lastError: unknown;
    const chain: string[] = [];

    const sameNoted = { done: false };
    backendAttempts: for (let attempt = 0; attempt < 6;) {
      const resolved = resolveBackend(req.stage, {
        forced: this.forced,
        routing: this.backendRouting,
        available,
        down: this.down,
        ...(req.avoidBackend !== undefined ? { avoid: req.avoidBackend } : {}),
      });
      if (!resolved) {
        throw new Error(this.noBackendMessage());
      }

      const { backend, fellBack } = resolved;
      this.noteSameBackend(req, backend, sameNoted);
      // 路由优先级：请求显式 model > 自定义 route > 分层 route（P3，backend-aware 模型分层）
      const route = this.resolveRoute(req, backend);
      if (!route) {
        attemptedFallback = true;
        continue backendAttempts;
      }
      // 已耗尽的路线不占执行次数，确保两个后端的三档都能被尝试。
      attempt++;
      chain.push(`${backend}:${route.model ?? "default"}`);
      const now = Date.now();
      const modelUsed = modelUsedLabel(route);
      const model = modelUsed ?? "default";
      const selectedAccount = this.accounts?.length
        ? pickAccount(this.accounts, this.quota ?? new QuotaTracker(), now, backend)
        : undefined;

      const adapter = getAdapter(backend);
      if (!adapter) throw new Error(`无此后端 adapter: ${backend}`);
      const accountEnv = selectedAccount?.env ? sanitizeAccountEnv(expandEnv(selectedAccount.env)) : undefined;
      await this.ensureProfileMcp(req.profileId);
      const profile = this.profileContext(req, accountEnv, adapter);
      const invRoute = backend === "codex" ? { ...route, writableRoots: collectToolchainWritableRoots(cwd) } : route;
      const inv = adapter.invoke(invRoute, req.tools ?? [], profile.mcpConfigPath);
      const prompt = this.buildPrompt(req);
      const file = inv.bin;
      const args = inv.promptVia === "argv" ? [...inv.args, prompt] : inv.args;
      const stdinInput = inv.promptVia === "stdin" ? prompt : undefined;
      const guarded = configureScopeGuard(req, backend, args, profile.env);
      this.assertIsolation(req, backend);
      const sb = this.applySandbox(file, guarded.args, cwd, req, backend);

      for (let cliAttempt = 1; cliAttempt <= 3; cliAttempt++) {
        let execution: ExecResult;
        try {
          execution = await this.exec(sb.file, sb.args, cwd, guarded.env, stdinInput);
        } catch (e) {
          lastError = e;
          if (this.isUnavailableError(e)) {
            this.markDown(backend, "auth", e instanceof Error ? e.message : String(e));
            attemptedFallback = true;
            continue backendAttempts;
          }

          const detail = e && typeof e === "object"
            ? e as { code?: unknown; exitCode?: unknown; message?: unknown; stderr?: unknown; stdout?: unknown }
            : undefined;
          const exitCode = typeof detail?.exitCode === "number" || detail?.exitCode === null
            ? detail.exitCode
            : 1;
          const stderrTail = failureTail(typeof detail?.stderr === "string" ? detail.stderr : "");
          const streamTail = failureTail([
            typeof detail?.message === "string" ? detail.message : String(e),
            typeof detail?.code === "string" ? detail.code : "",
            typeof detail?.stdout === "string" ? detail.stdout : "",
          ].filter(Boolean).join("\n"));
          const failure = classifyCliFailure(exitCode, stderrTail, streamTail);
          if (isBackendDownKind(failure.kind)) {
            this.markDown(backend, failure.kind, failure.reason);
            attemptedFallback = true;
            continue backendAttempts;
          }
          if (isModelDownKind(failure.kind)) {
            this.markModel(backend, route.model ?? "default", failure.kind, failure.reason);
            attemptedFallback = true;
            continue backendAttempts;
          }
          if (failure.transient && cliAttempt < 3) {
            await this.waitForRetry(cliAttempt, failure.reason);
            continue;
          }
          throw new Error(`[${failure.reason}] ${streamTail || stderrTail || "CLI execution failed"}`, { cause: e });
        }

        const { stdout, stderr, exitCode } = execution;
        // 仅当【无真实产出】且 stderr 报不可用时才判后端下线 —— exec 成功且有 stdout 就信任它，
        // 否则任务正文/告警里碰巧出现 "authentication failed" 等字样会误丢有效结果并误下线（对抗审查 LOW#1）。
        if (!stdout.trim() && this.isUnavailableText(stderr)) {
          this.markDown(backend, "auth", stderr);
          attemptedFallback = true;
          lastError = new Error(stderr);
          continue backendAttempts;
        }

        const parsed = adapter.parseOutput(stdout, stderr);
        if (this.isUnavailableResultText(parsed.text)) {
          this.markDown(backend, "auth", parsed.text);
          attemptedFallback = true;
          lastError = new Error(parsed.text);
          continue backendAttempts;
        }

        let failureReason: string | undefined;
        if (exitCode !== undefined && exitCode !== 0) {
          const failure = classifyCliFailure(exitCode, failureTail(stderr), failureTail(stdout));
          if (isBackendDownKind(failure.kind)) {
            this.markDown(backend, failure.kind, failure.reason);
            attemptedFallback = true;
            lastError = new Error(`[${failure.reason}] ${failureTail(stderr)}`);
            continue backendAttempts;
          }
          if (isModelDownKind(failure.kind)) {
            this.markModel(backend, route.model ?? "default", failure.kind, failure.reason);
            attemptedFallback = true;
            lastError = new Error(`[${failure.reason}] ${failureTail(stderr)}`);
            continue backendAttempts;
          }
          if (failure.transient && cliAttempt < 3) {
            await this.waitForRetry(cliAttempt, failure.reason);
            continue;
          }
          failureReason = failure.reason;
        }

        if (this.emptyResponseIsFailure && exitCode === 0 && parsed.text.trim() === ""
          && (parsed.tokens === undefined || parsed.tokens === 0)) {
          this.markDown(backend, "empty-response", "退出码 0 但无正文且零 token", EMPTY_RESPONSE_TTL_MS);
          attemptedFallback = true;
          lastError = new Error("[empty-response] 退出码 0 但无正文且零 token");
          continue backendAttempts;
        }

        if (selectedAccount) {
          this.quota?.record(selectedAccount.id, model, now); // 配额计一笔(按实际账号)
        } else {
          this.quota?.record(backend, model); // 配额计一笔(按实际后端)
        }

        if (this.quotaPath && this.quota) {
          await saveQuota(this.quotaPath, this.quota);
        }

        // 只从 adapter 解析出的主正文取最后一条 TESTCMD：claude 取 JSON result，codex 取 JSONL agent_message。
        // 不扫原始 stdout，否则 codex --json 内的转义换行无法匹配 TESTCMD 行。
        const primaryOut = failureReason ? `[${failureReason}] ${parsed.text}` : parsed.text;
        const testCmd = parseTestCmdLine(primaryOut);
        const tokens = parsed.tokens;
        const sandboxDenials = backend === "codex" ? countSandboxDenials(stdout) : 0;
        if (sandboxDenials > 0) console.warn(`[cli-runner] codex 沙箱拒绝 ${sandboxDenials} 次（Operation not permitted）`);
        return {
          text: primaryOut,
          meta: {
            ...(testCmd ? { testCmd } : {}),
            ...(tokens !== undefined ? { tokens } : {}),
            ...(sandboxDenials > 0 ? { sandboxDenials } : {}),
          },
          backend,
          fellBack: attemptedFallback || fellBack,
          modelUsed,
          chain,
        };
      }
    }

    const resolved = resolveBackend(req.stage, {
      forced: this.forced,
      routing: this.backendRouting,
      available,
      down: this.down,
      ...(req.avoidBackend !== undefined ? { avoid: req.avoidBackend } : {}),
    });
    if (!resolved || !this.resolveRoute(req, resolved.backend)) {
      throw new Error(this.noBackendMessage());
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
