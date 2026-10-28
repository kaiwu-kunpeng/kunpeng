/** 本机会话采集（Beacon 模式，升级调研 U5）：只读扫描 Claude Code（~/.claude/projects/<proj>/<id>.jsonl）
 *  与 Codex（~/.codex/sessions/**\/rollout-*.jsonl）的会话记录，用确定性规则抽出「纠错 / 调试模式」候选：
 *    ① 工具报错 → 随后同名工具调用成功（改法奏效）；② 用户说「不对 / 错了 / 应该…」纠正 assistant。
 *  硬约束：落盘前确定性脱敏（邮箱、手机号、身份证、常见密钥、家目录用户名）；正文用 wrapUntrusted 标不可信，
 *  且命中注入特征的候选直接丢弃；只读本机、零外发（Rule of Two）；产出 trustTier 0，只有人确认后才能晋级（C6）。
 *  只在命令被显式调用时运行。 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { classifyInjectionRisk, wrapUntrusted } from "../security/prompt-shield.js";
import type { LessonEntry } from "./lesson-store.js";

const SNIPPET = 240;

/** 确定性脱敏：顺序敏感（先整块私钥，再具体密钥，再通用形态）。username 给出时连同其各种写法一并替换。 */
export function redactSensitive(text: string, username?: string): string {
  const named = username && username.length >= 3
    ? text.split(new RegExp(username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join("<用户>")
    : text;
  return named
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<私钥>")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "<私钥>")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "<密钥>")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "<密钥>")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "<密钥>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <密钥>")
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD))=\S+/g, "$1=<密钥>")
    .replace(/"(api[_-]?key|apikey|access_token|refresh_token|token|client_secret|secret|password|passwd)"\s*:\s*"[^"]*"/gi, '"$1": "<密钥>"')
    .replace(/\b(api[_-]?key|apikey|access_token|refresh_token|token|client_secret|secret|password|passwd)=\S+/gi, "$1=<密钥>")
    .replace(/\b(postgresql|postgres|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/([^:@/\s]+):([^@\s]+)@/gi, "$1://$2:<密钥>@")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<邮箱>")
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, "<身份证>")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "<手机号>")
    .replace(/\/(Users|home)\/[^/\s"'`]+/g, "/$1/<用户>")
    .replace(/-(Users|home)-[A-Za-z0-9._]+(?=-|$)/g, "-$1-<用户>");
}

function clip(text: string, max = SNIPPET): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 会话事件的统一形态。 */
export interface SessionEvent {
  kind: "tool_call" | "tool_result" | "user_text" | "assistant_text";
  tool?: string;
  callId?: string;
  text: string;
  isError?: boolean;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (isRecordLike(part) && typeof part.text === "string" ? part.text : "")).join("\n");
  }
  return "";
}

/** 解析 Claude Code 会话 jsonl。 */
export function parseClaudeSession(raw: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  const toolNames = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let rec: unknown;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!isRecordLike(rec) || !isRecordLike(rec.message)) continue;
    const content = rec.message.content;
    if (rec.type === "user" && typeof content === "string") {
      events.push({ kind: "user_text", text: content });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecordLike(part)) continue;
      if (rec.type === "assistant" && part.type === "tool_use" && typeof part.name === "string") {
        const callId = typeof part.id === "string" ? part.id : undefined;
        if (callId) toolNames.set(callId, part.name);
        events.push({ kind: "tool_call", tool: part.name, ...(callId ? { callId } : {}), text: JSON.stringify(part.input ?? {}) });
      } else if (rec.type === "assistant" && part.type === "text" && typeof part.text === "string") {
        events.push({ kind: "assistant_text", text: part.text });
      } else if (rec.type === "user" && part.type === "text" && typeof part.text === "string") {
        events.push({ kind: "user_text", text: part.text });
      } else if (rec.type === "user" && part.type === "tool_result") {
        const callId = typeof part.tool_use_id === "string" ? part.tool_use_id : undefined;
        events.push({
          kind: "tool_result",
          ...(callId ? { callId, tool: toolNames.get(callId) } : {}),
          text: textOf(part.content),
          isError: part.is_error === true,
        });
      }
    }
  }
  return events;
}

const CODEX_FAIL = /Process exited with code [1-9]\d*|"exit_code"\s*:\s*[1-9]\d*/;

/** 解析 Codex 会话 jsonl（response_item：message / function_call / function_call_output）。 */
export function parseCodexSession(raw: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  const toolNames = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let rec: unknown;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!isRecordLike(rec) || rec.type !== "response_item" || !isRecordLike(rec.payload)) continue;
    const p = rec.payload;
    if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
      const text = textOf(p.content);
      if (text.trim()) events.push({ kind: p.role === "user" ? "user_text" : "assistant_text", text });
    } else if (p.type === "function_call" && typeof p.name === "string") {
      const callId = typeof p.call_id === "string" ? p.call_id : undefined;
      if (callId) toolNames.set(callId, p.name);
      events.push({ kind: "tool_call", tool: p.name, ...(callId ? { callId } : {}), text: typeof p.arguments === "string" ? p.arguments : "" });
    } else if (p.type === "function_call_output") {
      const callId = typeof p.call_id === "string" ? p.call_id : undefined;
      const text = typeof p.output === "string" ? p.output : JSON.stringify(p.output ?? "");
      events.push({ kind: "tool_result", ...(callId ? { callId, tool: toolNames.get(callId) } : {}), text, isError: CODEX_FAIL.test(text) });
    }
  }
  return events;
}

const CORRECTION = /(?:不对|错了|搞错|不是这样|应该(?:是|用|先)|别这样|不要这样|\bthat'?s wrong\b|\bwrong\b|\binstead\b|\bshould (?:be|use)\b)/i;
/** 系统注入的「用户消息」（命令回显、hook 提示、打断标记）不算人类纠正。 */
const SYSTEM_ECHO = /^\s*(?:<[a-z-]+>|#|Base directory for this skill|\[Request interrupted|Caveat:|<command-|<local-command|This session is being continued)/i;
/** 权限拒绝 / 安全绊线 / hook 拦截不是调试经验，不采。 */
const NOT_A_BUG = /Permission for this action was denied|denied by|绊线拦截|<tool_use_error>|hook error|was blocked|doesn't want to proceed|user rejected|requires? approval|needs? approval|requires? confirmation|contains multiple operations|Contains simple_expansion|Contains command substitution|Contains shell syntax|cannot be statically analyzed|审批/i;
/** 报错后多少个事件内出现同名工具成功调用，算「改法奏效」。 */
const RECOVERY_WINDOW = 12;

export interface HarvestCandidate {
  kind: "tool-recovery" | "user-correction";
  title: string;
  body: string;
  signature: string;
  at: number;
}

function signatureOf(...parts: string[]): string {
  return `harvest:${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16)}`;
}

/** 从事件序列抽候选（纯函数；输出已脱敏、未包裹）。 */
export function extractCandidates(events: readonly SessionEvent[], username?: string): HarvestCandidate[] {
  const red = (text: string): string => redactSensitive(text, username);
  const out: HarvestCandidate[] = [];
  const callInput = new Map<string, string>();
  for (const ev of events) if (ev.kind === "tool_call" && ev.callId) callInput.set(ev.callId, ev.text);
  events.forEach((ev, index) => {
    if (ev.kind === "tool_result" && ev.isError && ev.tool && !NOT_A_BUG.test(ev.text)) {
      const recovered = events.slice(index + 1, index + 1 + RECOVERY_WINDOW)
        .find((later) => later.kind === "tool_result" && later.tool === ev.tool && !later.isError);
      if (!recovered) return;
      const lines = ev.text.split("\n").map((l) => l.trim()).filter(Boolean);
      const errorLine = clip(red(lines.find((l) => !/^(?:Exit code \d+|Process exited with code \d+)$/i.test(l)) ?? lines[0] ?? ""), 80);
      const failed = clip(red(callInput.get(ev.callId ?? "") ?? ""));
      const fixed = clip(red(callInput.get(recovered.callId ?? "") ?? ""));
      out.push({
        kind: "tool-recovery",
        title: `${ev.tool} 报错后改法奏效：${errorLine}`,
        body: `报错：${clip(red(ev.text))}\n失败的调用：${failed}\n奏效的调用：${fixed}`,
        signature: signatureOf("tool-recovery", ev.tool, errorLine.replace(/\d+/g, "#")),
        at: index,
      });
    } else if (ev.kind === "user_text" && ev.text.length <= 1000 && CORRECTION.test(ev.text) && !SYSTEM_ECHO.test(ev.text)) {
      const prior = events.slice(0, index).reverse().find((e) => e.kind === "assistant_text");
      if (!prior) return;
      const next = events.slice(index + 1).find((e) => e.kind === "assistant_text");
      const correction = clip(red(ev.text), 160);
      out.push({
        kind: "user-correction",
        title: `用户纠正：${clip(correction, 60)}`,
        body: `纠正前 assistant：${clip(red(prior.text))}\n用户纠正：${correction}\n纠正后 assistant：${clip(red(next?.text ?? "(无)"))}`,
        signature: signatureOf("user-correction", correction),
        at: index,
      });
    }
  });
  return out;
}

/** 候选 → trustTier 0 的 lesson；命中注入特征返回 undefined（丢弃，不进上下文）。 */
export function candidateToLesson(candidate: HarvestCandidate, source: string, now: number): LessonEntry | undefined {
  if (classifyInjectionRisk(`${candidate.title}\n${candidate.body}`).risk === "high") return undefined;
  return {
    id: `harvest-${candidate.signature.slice("harvest:".length)}`,
    title: candidate.title,
    description: candidate.kind === "tool-recovery" ? "本机会话里工具报错后换一种做法成功（待人工确认）" : "本机会话里用户纠正了 agent 的做法（待人工确认）",
    content: wrapUntrusted(`本机会话 ${source}`, candidate.body),
    polarity: candidate.kind === "tool-recovery" ? "contrast" : "failure",
    evidence: `${source}#${candidate.at}`,
    signature: candidate.signature,
    sourceIds: [source],
    trustTier: 0,
    stats: { injected: 0, wins: 0, losses: 0 },
    createdAt: now,
  };
}

export interface SessionFile {
  path: string;
  format: "claude" | "codex";
}

async function listJsonl(dir: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  let entries: import("node:fs").Dirent[];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listJsonl(path, depth - 1));
    else if (entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}

/** 列出近 sinceMs 之后修改过的会话文件。 */
export async function findSessionFiles(home: string, sinceMs: number): Promise<SessionFile[]> {
  const claude = (await listJsonl(join(home, ".claude", "projects"), 1)).map((path) => ({ path, format: "claude" as const }));
  const codex = (await listJsonl(join(home, ".codex", "sessions"), 4)).map((path) => ({ path, format: "codex" as const }));
  const out: SessionFile[] = [];
  for (const file of [...claude, ...codex]) {
    try {
      if ((await stat(file.path)).mtimeMs >= sinceMs) out.push(file);
    } catch { /* 扫描期间被删，跳过 */ }
  }
  return out;
}

export interface HarvestResult {
  files: number;
  candidates: number;
  dropped: number;
  lessons: LessonEntry[];
}

/** 扫描并转成 lesson（按 signature 去重）；不写盘，写不写由调用方决定。 */
export async function harvestSessions(files: readonly SessionFile[], now: number, username?: string): Promise<HarvestResult> {
  const bySignature = new Map<string, LessonEntry>();
  let candidates = 0;
  let dropped = 0;
  for (const file of files) {
    let raw: string;
    try { raw = await readFile(file.path, "utf8"); } catch { continue; }
    const events = file.format === "claude" ? parseClaudeSession(raw) : parseCodexSession(raw);
    const source = `${file.format}:${basename(file.path)}`;
    for (const candidate of extractCandidates(events, username)) {
      candidates += 1;
      const lesson = candidateToLesson(candidate, source, now);
      if (!lesson) { dropped += 1; continue; }
      const prev = bySignature.get(lesson.signature!);
      bySignature.set(lesson.signature!, prev ? { ...prev, sourceIds: [...new Set([...prev.sourceIds, source])] } : lesson);
    }
  }
  return { files: files.length, candidates, dropped, lessons: [...bySignature.values()] };
}