import type { ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { WorkspaceDriver } from "../loop/workspace-driver.js";
import { kunpengStateDir } from "../project/state-dir.js";
import { resolveKunpengHome } from "../util/kunpeng-home.js";
import { chatRuleOfTwo } from "../security/rule-of-two.js";
import { renderDriverEvent } from "./ui/workbench-events.js";
import { escHtml, setSseHeaders, sseData, startSseHeartbeat } from "./chat-sse.js";
import { describeChatExit, isModelLimitError } from "./chat-exit-reason.js";
import { chatFallbackModel, fallbackBannerHtml } from "./chat-model-fallback.js";
import { UPLOAD_DIR, composeUserMessage, resolveUploads } from "./upload-endpoints.js";
import {
  appendConversationLoopRef,
  buildReplayTurns,
  capReplayTurns,
  persistChatRound,
  resolveConversationId,
} from "./chat-persistence.js";
import {
  findEnabledSkill,
  listPendingGateCards,
  splitSkillRequest,
} from "./gate-endpoints.js";
import {
  createTimingAgg,
  formatChatUsageLine,
  sumConversationUsd,
  timingAggFeed,
  timingAggFinish,
  usageWithModel,
} from "./chat-usage.js";
import {
  CHAT_COMMANDS,
  gateCardsText,
  matchChatCommand,
  renderGateCardsReply,
  type GateCardData,
} from "./chat-commands.js";
import { spawnStream } from "../agent/cli-stream.js";
import { parseClaudeStreamLine, parseCodexStreamLine } from "../agent/cli-stream-parse.js";
import { loadAccounts, pickAccount } from "../agent/account-pool.js";
import { loadQuota, saveQuota } from "../agent/quota-tracker.js";
import type {
  Conversation,
  ChatTurn as StoredChatTurn,
} from "../chat/conversation-store.js";
import { ConversationStore } from "../chat/conversation-store.js";
import { ReinjectStore } from "../feedback/reinject-store.js";
import { stableHash } from "../feedback/finding-to-task.js";
import { listSkills, recordSkillActivation, searchSkills, skillsRoot } from "../skills/registry.js";
import { CaptureStore, newCapture, resolveCapturesDir } from "../knowledge/capture-store.js";
import {
  buildLocalFsMcpConfig,
  chatMcpAllowlist,
  chatMcpNames,
  localFsConvFrame,
  mergeAllowedMcpServers,
  readGlobalMcpServers,
  withSwitchboardMcp,
} from "./localfs/chat-wiring.js";
import { hasSubscriptions, notify } from "./push.js";
import { chatRunKey, createChatRun } from "./chat-run-bus.js";
import {
  resolveHostPermissions,
  resolveHostToolPolicy,
  type HostCeiling,
  type HostToolPolicy,
  type WorkMode,
} from "./worker/host-permissions.js";
import { attachWorkerMcpToChatConfig, workerBannerHtml } from "./worker/chat-wiring.js";

const GPT6_MODELS = new Set(["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]);

/** 把一轮 say 的事件流写成 SSE 帧:每事件一行 `data: <html>\n\n`,结束补 `event: end`。 */
type StreamSayResponse =
  Pick<ServerResponse, "write" | "end" | "setHeader">
  & Partial<Pick<ServerResponse, "on">>;

export async function streamSay(
  driver: WorkspaceDriver,
  workspaceId: string,
  message: string,
  res: StreamSayResponse,
  model?: string,
): Promise<void> {
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("x-accel-buffering", "no");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  if (typeof res.on === "function") {
    res.on("close", () => driver.abort(workspaceId));
  }

  const stopHeartbeat = startSseHeartbeat(res);
  try {
    for await (const ev of driver.say(workspaceId, message, model)) {
      sseData(res, renderDriverEvent(ev));
    }
  } finally {
    stopHeartbeat();
  }
  res.write("event: end\ndata: {}\n\n");
  res.end();
}

// launchd 起的 serve PATH 极简(不含 ~/.local/bin),直接 spawn claude/codex 会 ENOENT。
// 给子进程注入补全的 PATH,把 claude/codex 所在目录焊进去。
export function binEnv(): Record<string, string> {
  const binDir = process.env.KUNPENG_CHAT_BIN_DIR?.trim();
  const extra = [...(binDir ? [binDir] : []), `${homedir()}/.local/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const cur = process.env.PATH ? process.env.PATH.split(":") : [];
  return { PATH: Array.from(new Set([...extra, ...cur])).join(":") };
}

export function chatBudgetVerdict(
  sessionUsd: number | undefined,
  env: Record<string, string | undefined>,
): { block: boolean; message?: string } {
  const budget = Number(env.KUNPENG_CHAT_SESSION_USD_BUDGET);
  if (!Number.isFinite(budget) || budget <= 0 || sessionUsd === undefined || sessionUsd < budget) {
    return { block: false };
  }
  return {
    block: true,
    message: `本会话当前累计 $${sessionUsd.toFixed(2)}，已达到预算 $${budget.toFixed(2)}（KUNPENG_CHAT_SESSION_USD_BUDGET）；请开新会话或调高预算。`,
  };
}

/** 聊天用账号解析:按后端选号;无账号/无匹配/耗尽或预检全败时返回空对象(聊天回退默认登录态,warn 不硬断)。 */
export async function chatAccountEnv(
  kunpengHome: string,
  backend: "claude" | "codex",
  now = Date.now(),
): Promise<{ id?: string; env?: Record<string, string> }> {
  const accounts = await loadAccounts({ home: kunpengHome }).catch(() => []);
  if (!accounts.length) return {};
  try {
    const quota = await loadQuota(join(kunpengHome, ".kunpeng", "quota.json"));
    quota.applyAccountConfig(accounts);
    const picked = pickAccount(accounts, quota, now, backend);
    return picked ? { id: picked.id, ...(picked.env ? { env: picked.env } : {}) } : {};
  } catch (e) {
    console.warn(`[聊天账号] 选号失败,回退默认登录态: ${String(e).slice(0, 120)}`);
    return {};
  }
}

/** 聊天用量归账:读-记-存 quota.json(accountId 为空时不动)。 */
export async function recordChatUsage(
  kunpengHome: string,
  accountId: string | undefined,
  model: string,
): Promise<void> {
  if (!accountId) return;
  try {
    const quotaPath = join(kunpengHome, ".kunpeng", "quota.json");
    const quota = await loadQuota(quotaPath);
    quota.record(accountId, model);
    await saveQuota(quotaPath, quota);
  } catch (e) {
    console.warn(`[聊天账号] 配额归账失败: ${String(e).slice(0, 120)}`);
  }
}

// ── 对话(chat):不跑 DevCycle,直接 Opus 4.8 流式问答,历史落 ConversationStore ──
export type ChatMode = "plan" | "act";

export function resolveChatMode(message: string, uiMode: string | undefined): { mode: ChatMode; cleanMessage: string } {
  const command = matchChatCommand(message);
  if (command?.name === "ask") return { mode: "plan", cleanMessage: command.rest };
  if (command?.name === "code" || command?.name === "act") return { mode: "act", cleanMessage: command.rest };
  return { mode: uiMode === "plan" ? "plan" : "act", cleanMessage: message };
}

const PLAN_ONLY_PROMPT = "【Plan 模式】本轮只讨论方案不动手：禁止修改文件，禁止执行任何写命令。请勿声称已启用真实只读沙箱。";
const COMPACT_PROMPT = "请把以上对话压缩成一份交接摘要(500字以内):保留任务目标、当前状态、已做决定、关键文件/命令/数据、未决事项;省略寒暄与过程细节。只输出摘要本身。";
const langRule = "【语言】无论上文(包括历史助手回复)是什么语言,你的回复始终使用简体中文;绝不使用日文、德文、法文、英文等任何其他语言作答。";

export function buildResumePrompt(userMsg: string, mode: ChatMode): string {
  return mode === "plan"
    ? `${PLAN_ONLY_PROMPT}\n\n${userMsg}\n\n${langRule}`
    : `${userMsg}\n\n${langRule}`;
}

export function buildChatPrompt(history: StoredChatTurn[], message: string, mode: ChatMode = "act", opts?: { droppedTurns?: number }): string {
  const sys = "你是鲲鹏 cockpit 内嵌的工作台助手,运行在当前 workspace 目录下,拥有完整工具能力:可以读取仓库文件、编辑或创建文件、执行命令、联网搜索,并基于工具结果实际动手完成用户交代的任务,而不只是用文字回答。请用简洁专业的中文沟通,需要时直接操作。"
    + "【重要·两套文件工具的边界】你的原生 Read/Write/Edit 等工具操作的是服务器(本机 workspace)上的文件;而 localfs_read/localfs_write/localfs_list/localfs_stat/localfs_delete/localfs_mkdir 这组 localfs_* 工具操作的是『用户在浏览器里授权的那个本地目录』(很可能是用户当前正在使用的另一台设备)。"
    + "【文件默认在本机】用户提到的文件默认在本机读取(当前 workspace 及服务器本机可达路径),直接用你的原生 Read 等工具打开;遇到 pptx/xlsx/docx/pdf 等二进制文档,用本机命令行工具(如 python-pptx、openpyxl、pdftotext)解析其内容,不要因为是二进制就回答『读不了』。"
    + "【localfs 只在明确点名时用】读取时,只有当用户明确点名『我的本地目录/我授权的目录/我电脑上的』这类指向用户另一台设备的文件时,才用 localfs_read/localfs_list/localfs_stat;此限制不适用于写入。若 localfs_* 调用报错(如未授权目录),如实告诉用户去对话框点『授权本地目录』,不要静默改用原生工具。"
    + "【写文件落点】新建、编辑或生成文件时,默认写到用户授权的本地目录;已授权的 localfs 目录就是已指定落点,直接写入、不再询问。只有用户明确说要写到服务器,才使用原生 Write/Edit 写到服务器。没有任何授权目录、或用户话中出现多个互斥落点时,落点不明确时必须停下来请用户指定,不得默认落到服务器。本规则仅限写入落点,不适用于任务需求澄清,且不改变读取行为。"
    + "使用 localfs_write/localfs_mkdir 写入前先 localfs_list 确认授权根与目标层级;收到 WROTE/MKDIR 回执后,必须在回复里说明完整落点(授权根目录名/相对路径/字节数),并把回执原样告诉用户;若回执带同名嵌套警告,也必须转告用户。"
    + "【选定目录=已确认·直接干】当用户已经在对话里授权或选定了本地目录(localfs),或已经给出目录范围,就把这一选定动作本身当作用户的确认与授权:直接读取该目录并推进任务——按需汇总、批量处理其中文件、或按用户的一句话指令执行;不得再反问『要不要扫描/你想干什么/请先描述需求』这类澄清问题,也不要求用户口述补充需求;信息不足时优先用合理默认先干起来,确需澄清最多合并成一次并在动手的同时提出。";
  const droppedTurns = opts?.droppedTurns ?? 0;
  const droppedNote = droppedTurns > 0
    ? `【提示:更早的 ${droppedTurns} 轮历史因过长未回放,如需完整上下文请让用户重述或使用 /compact】\n\n`
    : "";
  const turns = droppedNote + history.map((t) => `${t.role === "user" ? "用户" : "助手"}: ${t.text}`).join("\n\n");
  // 语言规则放在最末(紧贴生成点):全汉字短问题偶发被模型判成日文,一旦首句漂成日文,
  // 历史回放会把整场对话都带成日文;末尾规则同时压制新漂移和历史污染。
  const modeRule = mode === "plan" ? `${PLAN_ONLY_PROMPT}\n\n` : "";
  return `${modeRule}${sys}\n\n${turns ? `${turns}\n\n` : ""}${langRule}\n\n用户: ${message}\n\n助手:`;
}

export function resolveChatReplyText(
  answer: string,
  interrupted: boolean,
  killedBy?: "wall" | "idle",
  error?: string,
): string {
  if (interrupted) {
    if (killedBy === "wall") {
      return `${answer}\n\n⚠️[本轮已跑满 3 小时上限被系统终止:以上文字之后声称要执行的动作(如写文件)并未执行]`;
    }
    if (killedBy === "idle") {
      return `${answer}\n\n⚠️[本轮进程 5 分钟无任何输出,已被判定卡死并终止:以上文字之后声称要执行的动作(如写文件)并未执行]`;
    }
    return `${answer}\n\n⚠️[本轮连接中断、进程被终止:以上文字之后声称要执行的动作(如写文件)并未执行]`;
  }
  if (error && error.trim()) {
    const prefix = answer.trim() ? `${answer}\n\n` : "";
    return `${prefix}⚠️[本轮出错:${error}。以上文字之后声称要执行的动作(如写文件)并未执行]`;
  }
  if (answer.trim()) return answer;
  return "(本轮无文本回复，可能仅执行了工具操作)";
}

/**
 * 一轮结束后对 cliSessionId 该做什么。优先级固定:
 * compact 轮永远清空 > 续跑已回退则不动(避免把失效 id 写回) > 拿到有效 id 写回 > 否则不做。
 */
export function resolveCliSessionAction(input: {
  isCompactRound: boolean;
  latestSessionId?: string;
  resumeFallback: boolean;
}): { kind: "clear" } | { kind: "set"; sessionId: string } | { kind: "none" } {
  if (input.isCompactRound) return { kind: "clear" };
  if (input.resumeFallback) return { kind: "none" };
  if (input.latestSessionId !== undefined && input.latestSessionId.trim() !== "") {
    return { kind: "set", sessionId: input.latestSessionId };
  }
  return { kind: "none" };
}

function firstNotificationLine(value: string, fallback: string): string {
  return (value.split(/\r?\n/, 1)[0]?.trim() || fallback).slice(0, 180);
}

async function notifyChatResult(input: {
  title: string;
  answer: string;
  totalMs: number;
  error?: string;
  interrupted: boolean;
}): Promise<void> {
  if (!(await hasSubscriptions())) return;
  const title = (input.title.trim() || "鲲鹏对话").slice(0, 80);
  if (input.error || input.interrupted) {
    await notify({
      kind: "error",
      title,
      body: firstNotificationLine(input.answer, input.error || "本轮连接中断"),
      url: "/#/workbench",
    });
    return;
  }
  if (input.totalMs > 60_000) {
    await notify({
      kind: "done",
      title,
      body: firstNotificationLine(input.answer, "本轮已完成"),
      url: "/#/workbench",
    });
  }
}

// 支持的对话模型:claude 走 --model;codex 一律显式 -m(下拉 codex = gpt-5.5,不吃 ~/.codex/config.toml 默认)且走 --json(否则拿不到 usage,费用恒为空)。
// 图片:claude 在 prompt 写路径 + 允许 Read(其 Read 支持视觉);codex 用 -i flag。
// 联网:codex -c tools.web_search=true。
export function chatInvocation(model: string, imagePaths: string[], web: boolean, mcpConfigPath?: string, hasUploads = imagePaths.length > 0, resumeSessionId?: string, mode: ChatMode = "act", settingsPath?: string, toolPolicy?: HostToolPolicy): { bin: string; args: string[]; codex: boolean } {
  if (model === "codex" || GPT6_MODELS.has(model) || model.startsWith("gpt-5")) {
    const modelArgs = ["-m", model === "codex" ? "gpt-5.5" : model];
    const sandboxArgs = mode === "plan" || toolPolicy?.codexReadOnly
      ? ["--sandbox", "read-only"]
      : ["--dangerously-bypass-approvals-and-sandbox"];
    return {
      bin: "codex",
      args: ["exec", "--json", ...sandboxArgs, "--skip-git-repo-check", ...modelArgs, "-c", "model_reasoning_effort=high",
        ...(web ? ["-c", "tools.web_search=true"] : []),
        ...(imagePaths.length ? ["-i", imagePaths.join(",")] : [])],
      codex: true,
    };
  }
  const m = model.startsWith("claude-") ? model : "claude-opus-5";
  // 始终 bypassPermissions:对话走 -p 非交互模式,无法弹出授权,不绕过则任何需授权的工具
  // 被静默拒绝(用户侧表现为"用 /命令后点不了、被取消")。对齐 codex 的 --dangerously-bypass,
  // 让对话里的 /命令与工具一律放行,绝不卡在授权门。
  const extra: string[] = ["--permission-mode", mode === "plan" ? "plan" : "bypassPermissions"];
  if (toolPolicy?.allowTools) {
    extra.push("--tools", toolPolicy.allowTools.join(","));
  } else if (toolPolicy?.disallowTools.length) {
    extra.push("--disallowedTools", ...toolPolicy.disallowTools);
  }
  if (settingsPath) extra.push("--settings", settingsPath);
  if (mcpConfigPath) extra.push("--mcp-config", mcpConfigPath, "--strict-mcp-config");
  if (hasUploads) extra.push("--add-dir", UPLOAD_DIR);
  return {
    bin: "claude",
    args: ["-p", ...(resumeSessionId ? ["--resume", resumeSessionId] : []), "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", m, ...extra],
    codex: false,
  };
}

export async function writeChatModeSettings(
  convId: string,
  workMode: WorkMode,
  hostCeiling: HostCeiling = "full",
): Promise<string | undefined> {
  const deny = [...new Set(resolveHostPermissions(hostCeiling, workMode).deny)].sort();
  if (deny.length === 0) return undefined;
  const dir = join(kunpengStateDir(), "chat-settings");
  const path = join(kunpengStateDir(), "chat-settings", convId + ".settings.json");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify({ permissions: { deny } }), "utf8");
  } catch (error: unknown) {
    throw new Error(`工作模式约束写入失败，已中止对话: ${path}`, { cause: error });
  }
  return path;
}

let fallbackConversationStore: ConversationStore | undefined;

function defaultConversationStore(): ConversationStore {
  if (!fallbackConversationStore) {
    fallbackConversationStore = new ConversationStore(join(kunpengStateDir(), "chat"), {
      now: () => Date.now(),
      id: () => `conv-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    });
  }
  return fallbackConversationStore;
}

export function parseChatLoopCommand(message: string): { requirement: string } | null {
  const command = matchChatCommand(message);
  if (command?.name !== "loop") return null;
  const requirement = command.rest;
  return requirement ? { requirement: `[chat] ${requirement}` } : null;
}

function isSupportedChatModel(value: string): boolean {
  return value === "codex" || GPT6_MODELS.has(value) || value.startsWith("claude-") || value.startsWith("gpt-5");
}

function formatChatHelp(): string {
  return `${CHAT_COMMANDS.map((command) => `${command.usage} — ${command.description}`).join("\n")}\n/compact — 压缩当前会话上下文并从摘要继续`;
}

async function updateConversationModel(
  store: ConversationStore,
  username: string,
  convId: string,
  nextModel: string,
): Promise<void> {
  const baseDir = (store as unknown as { baseDir?: unknown }).baseDir;
  if (typeof baseDir !== "string" || !baseDir) throw new Error("Conversation store path unavailable");
  const path = join(baseDir, encodeURIComponent(username), `${encodeURIComponent(convId)}.json`);
  const raw = await readFile(path, "utf8");
  const conversation = JSON.parse(raw) as Conversation;
  if (conversation.id !== convId || conversation.username !== username) {
    throw new Error("Conversation identity mismatch");
  }
  conversation.model = nextModel;
  delete conversation.cliSessionId;
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(conversation, null, 2)}\n`, "utf8");
  try {
    await rename(tmp, path);
    // 复用公开写入口刷新会话索引，避免列表中的 model 与会话真相源分叉。
    await store.rename(username, convId, conversation.title);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

async function finishDirectChatCommand(
  res: ServerResponse,
  store: ConversationStore,
  username: string,
  convId: string,
  input: { message: string; replyText: string; web: boolean; replaceLast: boolean; error?: boolean; safeHtml?: string },
): Promise<void> {
  let replyText = input.replyText;
  let error = input.error === true;
  let safeHtml = input.safeHtml;
  try {
    await persistChatRound(store, username, convId, {
      userText: input.message,
      replyText,
      web: input.web,
      at: Date.now(),
    }, input.replaceLast);
  } catch (persistError: unknown) {
    const detail = persistError instanceof Error ? persistError.message : String(persistError);
    replyText = `对话持久化失败:${detail}`;
    error = true;
    safeHtml = undefined;
  }
  sseData(res, safeHtml ?? `<div class="kp-ev kp-ev-${error ? "error" : "done"}">${escHtml(replyText)}</div>`);
  res.write("event: end\ndata: {}\n\n");
  res.end();
}

export async function streamChat(
  workspaceId: string, message: string, model: string, imageIds: string[], web: boolean, cwd: string,
  res: ServerResponse,
  deps: { store?: ConversationStore; username?: string; conv?: string; session?: string; projectId?: string; accountId?: string; localfsToken?: string; mode?: string; workMode?: WorkMode; hostCeiling?: HostCeiling; replaceLast?: boolean; sensitive?: boolean; kunpengHome?: string; listGates?: () => Promise<GateCardData[]> } = {},
): Promise<void> {
  const command = matchChatCommand(message);
  const isCompactRound = command?.name === "compact";
  const resolved = resolveChatMode(message, deps.mode);
  const loopCommand = parseChatLoopCommand(resolved.cleanMessage);
  setSseHeaders(res);
  const store = deps.store ?? defaultConversationStore();
  const username = deps.username ?? "local";
  const kunpengHome = deps.kunpengHome ?? resolveKunpengHome();
  const convId = await resolveConversationId(store, username, {
    conv: deps.conv,
    session: deps.session,
    model,
    projectId: deps.projectId,
    sensitive: deps.sensitive,
  });
  if (deps.replaceLast === true) await store.clearCliSessionId(username, convId);
  sseData(res, localFsConvFrame(convId));
  if (command?.name === "loop" && !loopCommand) {
    await finishDirectChatCommand(res, store, username, convId, {
      message,
      replyText: "用法: /loop <需求>",
      web,
      replaceLast: deps.replaceLast === true,
      error: true,
    });
    return;
  }
  if (loopCommand) {
    let replyText: string;
    try {
      const { requirement } = loopCommand;
      const fingerprint = stableHash(`chat:loop|${requirement}`);
      const feedbackStore = new ReinjectStore(join(cwd, ".kunpeng", "feedback"));
      await feedbackStore.enqueue([{
        fingerprint,
        requirement,
        source: "chat:loop",
        severity: "error",
      }], Date.now());
      await appendConversationLoopRef(store, username, convId, fingerprint);
      replyText = `已入队自建循环(飞轮下轮自动拉起):${requirement.slice(0, 80)}`;
      await persistChatRound(store, username, convId, {
        userText: message,
        replyText,
        web,
        at: Date.now(),
      }, deps.replaceLast === true);
      const shortFingerprint = fingerprint.slice(0, 12);
      sseData(res, `<div class="kp-ev kp-ev-done kp-loop-card" data-loop-fp="${escHtml(shortFingerprint)}"><span class="kp-loop-copy">${escHtml(replyText)}</span><code class="kp-loop-fp">${escHtml(shortFingerprint)}</code><button class="kp-loop-backlog" type="button" data-loop-backlog>查看 backlog</button></div>`);
    } catch (e: unknown) {
      replyText = `入队自建循环失败:${e instanceof Error ? e.message : String(e)}`;
      sseData(res, `<div class="kp-ev kp-ev-error">${escHtml(replyText)}</div>`);
      try {
        await persistChatRound(store, username, convId, {
          userText: message,
          replyText,
          web,
          at: Date.now(),
        }, deps.replaceLast === true);
      } catch (persistError: unknown) {
        const detail = persistError instanceof Error ? persistError.message : String(persistError);
        sseData(res, `<div class="kp-ev kp-ev-error">${escHtml(`对话持久化失败:${detail}`)}</div>`);
      }
    }
    res.write("event: end\ndata: {}\n\n");
    res.end();
    return;
  }
  let conversation: Conversation | null = null;
  let persistedSessionUsd: number | undefined;
  try {
    conversation = await store.get(username, convId);
    persistedSessionUsd = sumConversationUsd(conversation?.turns ?? []);
  } catch {
    // 历史读取失败时仍允许本轮继续，但不输出无法证实的会话累计值。
    persistedSessionUsd = undefined;
  }

  const budgetVerdict = chatBudgetVerdict(persistedSessionUsd, process.env);
  if (budgetVerdict.block) {
    await finishDirectChatCommand(res, store, username, convId, {
      message,
      replyText: budgetVerdict.message ?? "本会话已达到预算，请开新会话或调高预算。",
      web,
      replaceLast: deps.replaceLast === true,
    });
    return;
  }

  let commandMessage = isCompactRound ? COMPACT_PROMPT : resolved.cleanMessage;
  if (command && !["ask", "code", "act", "loop", "skill", "compact"].includes(command.name)) {
    let replyText: string;
    let error = false;
    let safeHtml: string | undefined;
    try {
      if (command.name === "help") {
        replyText = formatChatHelp();
      } else if (command.name === "gates") {
        const cards = await (deps.listGates?.() ?? listPendingGateCards(cwd, deps.projectId ?? workspaceId));
        replyText = gateCardsText(cards);
        if (cards.length > 0) safeHtml = renderGateCardsReply(cards);
      } else if (command.name === "model") {
        if (!command.rest || !isSupportedChatModel(command.rest)) {
          throw new Error("用法: /model claude-*|codex|gpt-5*|gpt-6-astra|gpt-6-sol|gpt-6-luna");
        }
        await updateConversationModel(store, username, convId, command.rest);
        replyText = `本会话模型已切 ${command.rest}`;
      } else if (command.name === "cost") {
        const turns = conversation?.turns ?? [];
        const tokens = turns.reduce((total, turn) => total + Math.max(0, turn.usage?.input ?? 0) + Math.max(0, turn.usage?.output ?? 0), 0);
        replyText = `本会话累计 tokens ${tokens} · $${sumConversationUsd(turns).toFixed(4)}`;
      } else if (command.name === "status") {
        const currentModel = conversation?.model ?? model;
        const rounds = (conversation?.turns ?? []).filter((turn) => turn.role === "user").length;
        replyText = `模型 ${currentModel} · 模式 ${resolved.mode} · 轮数 ${rounds}`;
      } else if (command.name === "skills") {
        const matches = searchSkills(skillsRoot(), command.rest, { enabled: true }).slice(0, 15);
        replyText = matches.length
          ? matches.map((skill) => `${skill.name} — ${skill.description.slice(0, 40)}`).join("\n")
          : "没有匹配的已启用技能";
      } else if (command.name === "capture") {
        if (conversation?.sensitive === true) {
          replyText = "🔒 敏感会话:内容不进知识库";
        } else {
          const lastReply = [...(conversation?.turns ?? [])].reverse().find((turn) => turn.role === "assistant" && turn.text.trim());
          if (!lastReply) throw new Error("没有可捕获的助手回复");
          const capture = newCapture({
            source: "chat",
            kind: "text",
            raw: lastReply.text,
            title: conversation?.title,
            projectId: deps.projectId,
            citedFrom: `chat:${convId}`,
          }, {
            now: () => Date.now(),
            id: () => `cap-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
          });
          const appended = await new CaptureStore(resolveCapturesDir(cwd)).appendCapture(capture);
          if (!appended) throw new Error("知识库拒绝重复 capture id");
          replyText = `已捕获到知识库 ${capture.id}`;
        }
      } else if (command.name === "clear") {
        replyText = "请用左上新建会话按钮；/clear 不删历史";
      } else if (command.name === "web" || command.name === "open" || command.name === "files") {
        replyText = `/${command.name} 是聊天窗口命令，请在浏览器工作台中使用`;
        error = true;
      } else if (command.name === "stop") {
        replyText = "当前请求未在生成；生成中请使用停止按钮或 /stop";
      } else {
        replyText = `未知命令 /${command.name}；输入 /help 查看全部`;
        error = true;
      }
    } catch (commandError: unknown) {
      replyText = commandError instanceof Error ? commandError.message : String(commandError);
      error = true;
    }
    await finishDirectChatCommand(res, store, username, convId, {
      message,
      replyText,
      web,
      replaceLast: deps.replaceLast === true,
      error,
      safeHtml,
    });
    return;
  }

  if (command?.name === "skill") {
    const request = splitSkillRequest(command.rest);
    if (!request) {
      await finishDirectChatCommand(res, store, username, convId, {
        message,
        replyText: "用法: /skill <id> [任务]",
        web,
        replaceLast: deps.replaceLast === true,
        error: true,
      });
      return;
    }
    try {
      const skill = findEnabledSkill(request.id);
      if (!skill) throw new Error(`技能不存在或未启用: ${request.id}`);
      const methodology = await readFile(join(skill.dir, "SKILL.md"), "utf8");
      if (!methodology.trim()) throw new Error(`技能内容为空: ${request.id}`);
      if (!request.task) {
        await finishDirectChatCommand(res, store, username, convId, {
          message,
          replyText: `${skill.name} — ${skill.description}`,
          web,
          replaceLast: deps.replaceLast === true,
        });
        return;
      }
      commandMessage = `按以下技能方法论执行:\n${methodology}\n\n用户任务:\n${request.task}`;
      try {
        recordSkillActivation(skillsRoot(), [skill.id]);
      } catch {
        // 用量埋点不能阻断技能正文注入后的对话。
      }
    } catch (skillError: unknown) {
      await finishDirectChatCommand(res, store, username, convId, {
        message,
        replyText: skillError instanceof Error ? skillError.message : String(skillError),
        web,
        replaceLast: deps.replaceLast === true,
        error: true,
      });
      return;
    }
  }

  const uploaded = resolveUploads(imageIds);
  const chatSafety = chatRuleOfTwo({
    mode: resolved.mode,
    explicitAct: command?.name === "act" || command?.name === "code",
    web,
    uploads: uploaded.images.length + uploaded.files.length,
  });
  const openingBanners: string[] = [];
  if (chatSafety.mode === "plan") {
    openingBanners.push('<div class="kp-ev kp-ev-stage">Plan 模式：本轮只出方案不动手</div>');
  }
  if (chatSafety.downgraded) {
    openingBanners.push('<div class="kp-ev kp-ev-stage">Rule of Two：本轮带联网或上传内容，已自动降为 Plan，只出方案不动手；确需动手请用 /act 开头重发</div>');
  }
  const imagePaths = uploaded.images;
  const mcpConfigPath = await writeLocalFsMcpConfig(convId, deps.localfsToken ?? "");
  const workMode = deps.workMode ?? "full";
  if (workMode === "trip") {
    const machine = await attachWorkerMcpToChatConfig(mcpConfigPath, {
      accountId: deps.accountId,
      conv: convId,
      baseUrl: "http://127.0.0.1:7788",
      token: deps.localfsToken ?? "",
    });
    openingBanners.push(workerBannerHtml(machine));
  }
  if (workMode === "intranet") {
    openingBanners.push('<div class="kp-ev kp-ev-stage">内网模式：只是个标记，工具权限与满血一致；不是网络隔离</div>');
  }
  const toolPolicy = resolveHostToolPolicy(deps.hostCeiling ?? "full", workMode);
  const settingsPath = await writeChatModeSettings(convId, workMode, deps.hostCeiling ?? "full");
  const inv = chatInvocation(model, imagePaths, web, mcpConfigPath, imagePaths.length + uploaded.files.length > 0, conversation?.cliSessionId, chatSafety.mode, settingsPath, toolPolicy);
  const userMsg = composeUserMessage(commandMessage, imagePaths, uploaded.files, inv.codex);
  const useClaudeResume = !inv.codex && Boolean(conversation?.cliSessionId);
  const rawHist = useClaudeResume ? [] : conversation ? buildReplayTurns(conversation, deps.replaceLast === true) : [];
  const { turns: hist, dropped } = capReplayTurns(rawHist, Number(process.env.KUNPENG_CHAT_REPLAY_MAX_CHARS ?? 200000));
  const prompt = useClaudeResume ? buildResumePrompt(userMsg, chatSafety.mode) : buildChatPrompt(hist, userMsg, chatSafety.mode, { droppedTurns: dropped });
  const parse = inv.codex ? parseCodexStreamLine : parseClaudeStreamLine;
  const chatAcct = await chatAccountEnv(kunpengHome, inv.codex ? "codex" : "claude");
  const run = createChatRun(chatRunKey(username, convId));
  const detach = run.subscribe(res, 0);
  for (const banner of openingBanners) run.emit(banner);
  const ac = new AbortController();
  run.bindAbort(() => ac.abort());
  const stopHeartbeat = startSseHeartbeat(res);
  res.on("close", () => {
    detach();
    stopHeartbeat();
  });
  let answer = "";
  let lastUsage: { input?: number; output?: number; cacheCreate?: number; cacheRead?: number; model?: string } | undefined;
  let latestSessionId: string | undefined;
  let resumeFallback = false;
  const t0 = Date.now();
  const timingAgg = createTimingAgg();
  let totalMs: number;
  let streamError: string | undefined;
  let cliError: string | undefined;
  let fellBackTo: string | undefined;
  let firstTokenMs: number | undefined;
  let killedBy: "wall" | "idle" | undefined;
  let toolInputChars = 0;
  let lastToolInputProgressChars = 0;
  try {
    // 原始 stdout 会持续刷新 5 分钟空闲计时，真死进程会被及时回收；3 小时墙钟只作极端兜底。
    const onLine = (line: string) => {
      const d = parse(line);
      if (!d) return;
      const eventAt = Date.now() - t0;
      if (d.sessionId) latestSessionId = d.sessionId;
      if (d.error) cliError = d.error;
      if (d.tool) {
        toolInputChars = 0;
        lastToolInputProgressChars = 0;
        timingAggFeed(timingAgg, { kind: "toolUse", at: eventAt, ...(d.toolId === undefined ? {} : { toolId: d.toolId }) });
        run.emit(`<div class="kp-ev kp-tool" data-tool-id="${escHtml(d.toolId ?? "")}"><span class="kp-tool-ic">⟳</span> <span class="kp-tool-name">${escHtml(d.tool.replace(/^mcp__\w+__/, ""))}</span> <span class="kp-tool-st">执行中…</span></div>`);
      }
      if (typeof d.toolInputChars === "number") {
        toolInputChars += d.toolInputChars;
        if (toolInputChars - lastToolInputProgressChars >= 2_000) {
          lastToolInputProgressChars = toolInputChars;
          run.emit(`<div class="kp-tool-arg" data-chars="${toolInputChars}"></div>`);
        }
      }
      if (d.toolResult) {
        timingAggFeed(timingAgg, { kind: "toolResult", at: eventAt, toolId: d.toolResult.id });
        run.emit(`<div class="kp-tool-upd" data-tool-id="${escHtml(d.toolResult.id)}" data-ok="${d.toolResult.ok ? "1" : "0"}"></div>`);
      }
      if (d.thinking) run.emit(`<span class="kp-ev-think">${escHtml(d.thinking)}</span>`);
      if (d.text) {
        if (firstTokenMs === undefined) firstTokenMs = Date.now() - t0;
        answer += d.text;
        run.emit(`<span class="kp-ev-token">${escHtml(inv.codex ? `${d.text}\n` : d.text)}</span>`);
      }
      if (d.usage) {
        lastUsage = usageWithModel({ input: d.usage.input, output: d.usage.output, model: d.usage.model }, model);
        if (typeof d.usage.cacheCreate === "number") lastUsage.cacheCreate = d.usage.cacheCreate;
        if (typeof d.usage.cacheRead === "number") lastUsage.cacheRead = d.usage.cacheRead;
      }
    };
    const spawnOpts = { stdinInput: prompt, timeoutMs: 10_800_000, idleTimeoutMs: 300_000, env: { ...binEnv(), ...(chatAcct.env ?? {}) }, signal: ac.signal };
    let attemptArgs = inv.args;
    for (;;) {
      const r = await spawnStream(inv.bin, attemptArgs, cwd, onLine, spawnOpts);
      killedBy = r.killedBy;
      if (r.exitCode === 0 || ac.signal.aborted) break;
      // 额度用尽且本轮还没吐出任何正文:换备用模型原样重跑一次,只降一级。
      const fallback = !inv.codex && fellBackTo === undefined && answer.trim() === "" && isModelLimitError(cliError) ? chatFallbackModel(model) : undefined;
      if (fallback) {
        fellBackTo = fallback;
        cliError = undefined;
        lastUsage = undefined;
        run.emit(fallbackBannerHtml(model, fallback));
        attemptArgs = chatInvocation(fallback, imagePaths, web, mcpConfigPath, imagePaths.length + uploaded.files.length > 0, conversation?.cliSessionId, chatSafety.mode, settingsPath, toolPolicy).args;
        continue;
      }
      // 非正常退出以前被静默吞掉,用户只看到"卡住";把真因(result.is_error 正文或 stderr 尾部)透出来。
      streamError = describeChatExit(r.exitCode, cliError, r.stderr);
      // 额度用尽不是会话失效,清掉 cliSessionId 只会让下一条消息重放全量历史白花钱。
      if (useClaudeResume && !isModelLimitError(cliError)) {
        resumeFallback = true;
        await store.clearCliSessionId(username, convId).catch(() => {});
        run.emit(`<div class="kp-ev kp-ev-error">会话续跑失效,已自动回退,下一条消息将带完整历史重试</div>`);
      }
      run.emit(`<div class="kp-ev kp-ev-error">${escHtml(streamError)}</div>`);
      break;
    }
  } catch (e: unknown) {
    streamError = e instanceof Error ? e.message : String(e);
    run.emit(`<div class="kp-ev kp-ev-error">出错:${escHtml(streamError)}</div>`);
  } finally {
    stopHeartbeat();
    totalMs = Date.now() - t0;
    const timing = timingAggFinish(timingAgg, totalMs);
    console.log("[chat-timing]", JSON.stringify({
      conv: convId,
      model,
      firstTokenMs: firstTokenMs ?? null,
      totalMs,
      toolMs: timing.toolMs,
      modelMs: timing.modelMs,
      turns: timing.turns,
      resumed: useClaudeResume,
      fallback: fellBackTo ?? null,
    }));
    if (lastUsage) {
      const sessionUsd = persistedSessionUsd === undefined
        ? undefined
        : persistedSessionUsd + sumConversationUsd([{ usage: lastUsage }]);
      run.emit(`<div class="kp-ev kp-ev-usage">${escHtml(formatChatUsageLine(lastUsage, model, sessionUsd, {
        firstTokenMs,
        totalMs,
        toolMs: timing.toolMs,
        turns: timing.turns,
      }))}</div>`);
    }
    await recordChatUsage(kunpengHome, chatAcct.id, lastUsage?.model ?? "default").catch(() => {});
  }
  // 空文本轮也必须入库:工具轮/中断轮若丢失,下一轮历史会误导模型以为没有发生过。
  const interrupted = ac.signal.aborted || killedBy !== undefined;
  try {
    await persistChatRound(store, username, convId, {
      userText: message,
      replyText: resolveChatReplyText(answer, interrupted, killedBy, streamError),
      web,
      at: Date.now(),
      usage: lastUsage,
      ...(isCompactRound ? { compact: true } : {}),
    }, deps.replaceLast === true);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    run.emit(`<div class="kp-ev kp-ev-error">${escHtml(`对话持久化失败:${detail}`)}</div>`);
  }
  const sessionAction = resolveCliSessionAction({ isCompactRound, latestSessionId, resumeFallback });
  if (sessionAction.kind === "clear") {
    await store.clearCliSessionId(username, convId).catch(() => {});
  } else if (sessionAction.kind === "set") {
    await store.setCliSessionId(username, convId, sessionAction.sessionId).catch(() => {});
  }
  const compactInputTokens = (lastUsage?.input ?? 0)
    + (lastUsage?.cacheCreate ?? 0)
    + (lastUsage?.cacheRead ?? 0);
  if (!isCompactRound && compactInputTokens > Number(process.env.KUNPENG_CHAT_COMPACT_HINT ?? 140000)) {
    run.emit('<div class="kp-ev kp-ev-done">上下文较长，可发送 /compact 压缩后继续</div>');
  }
  const notificationTitle = (await store.get(username, convId).catch(() => null))?.title
    ?? conversation?.title
    ?? "鲲鹏对话";
  run.endRun();
  res.end();
  void notifyChatResult({
    title: notificationTitle,
    answer,
    totalMs,
    error: streamError,
    interrupted,
  }).catch((error: unknown) => {
    console.error("[web-push] 对话通知失败", error);
  });
}

export async function writeLocalFsMcpConfig(convId: string, token = "", baseDir?: string): Promise<string> {
  const dir = join(baseDir ?? kunpengStateDir(), "chat-mcp");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${convId}.localfs.mcp.json`);
  const base = buildLocalFsMcpConfig(convId, "http://127.0.0.1:7788", token);
  // 白名单 = 环境变量 + 已启用技能声明的 MCP + 总机;读注册表失败(缺失/坏档)降级为原行为,绝不让对话起不来。
  let allowlist: string[];
  try {
    allowlist = withSwitchboardMcp(chatMcpNames(process.env, listSkills(skillsRoot())));
  } catch {
    allowlist = chatMcpAllowlist(process.env);
  }
  const merged = mergeAllowedMcpServers(
    base,
    readGlobalMcpServers(join(homedir(), ".claude.json")),
    allowlist,
  );
  await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}
