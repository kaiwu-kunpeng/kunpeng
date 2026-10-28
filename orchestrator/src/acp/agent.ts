/** ACP（Agent Client Protocol）v1 薄适配层：鲲鹏作为 ACP agent 被编辑器（Zed / JetBrains / Neovim…）以子进程拉起，
 *  走 stdio 上按行分隔的 JSON-RPC 2.0。暴露 /status 看流、/run <spec 绝对路径> 派流、/answer <flowId> <回复> 答复求助并续跑。
 *  规范：https://agentclientprotocol.com/protocol/v1 （2026-09-24 核实：protocolVersion 为整数 1，判别字段 sessionUpdate）。
 *  stdout 只写协议消息，日志一律走 stderr。 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { isRecord } from "../util/is-record.js";

export const ACP_PROTOCOL_VERSION = 1;

export interface AcpFlowSummary {
  flowId: string;
  status: string;
  stage: string;
  updatedAt: number;
  blocker?: string;
  gate?: string;
  /** agent 主动求助、等人答复（可用 /answer）。 */
  raisedBlocker?: boolean;
}

export interface AcpDeps {
  version: string;
  listFlows(cwd: string): Promise<AcpFlowSummary[]>;
  dispatch(cwd: string, specPath: string, acceptCmd: string): Promise<{ pid: number; logPath: string }>;
  /** 缺省时 /answer 回「不支持」。 */
  answerBlocker?: (cwd: string, flowId: string, reply: string) => Promise<{ ok: boolean; message: string }>;
  readFile?: (path: string) => string;
  newSessionId?: () => string;
}

type JsonRpcId = string | number | null;
type Send = (message: Record<string, unknown>) => void;

const COMMANDS = [
  { name: "run", description: "派一条开发流（参数：带 accept 块的 spec 绝对路径）", input: { hint: "spec 绝对路径，如 /repo/docs/specs/x.md" } },
  { name: "status", description: "查看当前项目的流状态与卡点" },
  { name: "answer", description: "答复 agent 的求助并续跑", input: { hint: "<flowId> <回复>" } },
];

const HELP = [
  "鲲鹏 ACP 适配层支持：",
  "- /status：查看当前项目最近的流、状态与卡点",
  "- /run <spec 绝对路径>：派一条开发流（spec 必须带 accept 块；也可以把 .md 文件拖进来再输入 /run）",
  "- /answer <flowId> <回复>：答复 agent 的求助，并从 checkpoint 续跑",
  "一句话需求请先写成带 scope 与 accept 的 spec，再用 /run 派发。",
].join("\n");

/** spec 里的 ```accept 块（单行或多行，取去掉首尾空白后的内容）。 */
export function extractAcceptBlock(spec: string): string | undefined {
  const fence = "`".repeat(3);
  const match = new RegExp(`^${fence}accept\\n([\\s\\S]*?)\\n${fence}`, "m").exec(spec);
  const cmd = match?.[1]?.trim();
  return cmd ? cmd : undefined;
}

export function formatFlowStatus(flows: readonly AcpFlowSummary[], limit = 10): string {
  if (flows.length === 0) return "当前项目还没有流。";
  const recent = [...flows].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  return recent.map((flow) => {
    const extra = [flow.gate ? `门：${flow.gate}` : "", flow.blocker ? `卡点：${flow.blocker}` : ""].filter(Boolean).join("；");
    const hint = flow.raisedBlocker ? ` · 用 /answer ${flow.flowId} <回复> 答复` : "";
    return `- ${flow.flowId} · ${flow.stage}/${flow.status}${extra ? ` · ${extra}` : ""}${hint}`;
  }).join("\n");
}

/** 从 prompt 内容块里取文本与第一个 .md 文件引用（resource_link 的 file:// uri）。 */
function readPrompt(prompt: unknown): { text: string; linkedMd?: string } {
  const blocks = Array.isArray(prompt) ? prompt : [];
  const text = blocks.filter((b) => isRecord(b) && b.type === "text" && typeof b.text === "string").map((b) => (b as { text: string }).text).join("\n").trim();
  const link = blocks.find((b) => isRecord(b) && b.type === "resource_link" && typeof b.uri === "string" && /^file:\/\/.+\.md$/i.test(b.uri));
  return { text, ...(link ? { linkedMd: fileURLToPath((link as { uri: string }).uri) } : {}) };
}

export function createAcpAgent(deps: AcpDeps, send: Send): { handle(line: string): Promise<void> } {
  const sessions = new Map<string, string>();
  const reply = (id: JsonRpcId, result: Record<string, unknown>) => send({ jsonrpc: "2.0", id, result });
  const fail = (id: JsonRpcId, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });
  const say = (sessionId: string, text: string) => send({
    jsonrpc: "2.0", method: "session/update",
    params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } },
  });
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, "utf8"));

  async function prompt(id: JsonRpcId, params: Record<string, unknown>): Promise<void> {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    const cwd = sessions.get(sessionId);
    if (!cwd) return fail(id, -32602, `未知会话 ${sessionId || "(空)"}，请先 session/new`);
    const { text, linkedMd } = readPrompt(params.prompt);
    if (/^\/?status\b/i.test(text)) {
      say(sessionId, formatFlowStatus(await deps.listFlows(cwd)));
    } else if (/^\/run\b/i.test(text)) {
      const specPath = text.replace(/^\/run\b/i, "").trim() || linkedMd || "";
      if (!specPath || !isAbsolute(specPath) || !/\.md$/i.test(specPath)) {
        say(sessionId, `没有派流：/run 需要带 accept 块的 spec 绝对路径（.md）。\n\n${HELP}`);
      } else {
        let spec: string | undefined;
        try {
          spec = readFile(specPath);
        } catch (error) {
          say(sessionId, `没有派流：读不到 spec 文件 ${specPath}（${String(error)}）`);
        }
        const accept = spec === undefined ? undefined : extractAcceptBlock(spec);
        if (spec !== undefined && !accept) say(sessionId, `没有派流：${specPath} 缺少 accept 块，派出去会直接回滚。`);
        if (spec !== undefined && accept) {
          const launched = await deps.dispatch(cwd, specPath, accept);
          say(sessionId, `已派流（pid ${launched.pid}），日志：${launched.logPath}\n用 /status 查看进度。`);
        }
      }
    } else if (/^\/answer\b/i.test(text)) {
      const match = /^\/answer\s+(\S+)\s+([\s\S]+)$/i.exec(text);
      if (!match) {
        say(sessionId, "用法：/answer <flowId> <回复>");
      } else if (!deps.answerBlocker) {
        say(sessionId, "当前实例不支持 /answer。");
      } else {
        const result = await deps.answerBlocker(cwd, match[1]!, match[2]!);
        say(sessionId, result.ok ? result.message : `没有续跑：${result.message}`);
      }
    } else {
      say(sessionId, HELP);
    }
    reply(id, { stopReason: "end_turn" });
  }

  return {
    async handle(line: string): Promise<void> {
      if (!line.trim()) return;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return fail(null, -32700, "Parse error");
      }
      if (!isRecord(message) || typeof message.method !== "string") return;
      const isRequest = "id" in message;
      const id = (isRequest ? message.id : null) as JsonRpcId;
      const params = isRecord(message.params) ? message.params : {};
      if (!isRequest) return; // 通知（含 session/cancel）无响应；本适配层的 prompt 都是即时返回，无可取消的长任务。
      try {
        switch (message.method) {
          case "initialize":
            return reply(id, {
              protocolVersion: ACP_PROTOCOL_VERSION,
              agentCapabilities: {
                loadSession: false,
                promptCapabilities: { image: false, audio: false, embeddedContext: false },
                mcpCapabilities: { http: false, sse: false },
              },
              authMethods: [],
              agentInfo: { name: "kunpeng", title: "鲲鹏", version: deps.version },
            });
          case "authenticate":
            return reply(id, {});
          case "session/new": {
            if (typeof params.cwd !== "string" || !isAbsolute(params.cwd) || !Array.isArray(params.mcpServers)) {
              return fail(id, -32602, "session/new 需要绝对路径 cwd 与 mcpServers 数组");
            }
            const sessionId = deps.newSessionId?.() ?? `kp-${randomBytes(8).toString("hex")}`;
            sessions.set(sessionId, params.cwd);
            reply(id, { sessionId });
            send({
              jsonrpc: "2.0", method: "session/update",
              params: { sessionId, update: { sessionUpdate: "available_commands_update", availableCommands: COMMANDS } },
            });
            return;
          }
          case "session/prompt":
            return await prompt(id, params);
          default:
            return fail(id, -32601, `Method not found: ${message.method}`);
        }
      } catch (error) {
        return fail(id, -32603, `Internal error: ${String(error)}`);
      }
    },
  };
}

/** stdio 主循环：按行读 stdin、每条响应/通知一行写 stdout。 */
export async function runAcpStdio(
  input: NodeJS.ReadableStream,
  output: { write(chunk: string): unknown },
  deps: AcpDeps,
): Promise<void> {
  const agent = createAcpAgent(deps, (message) => { output.write(`${JSON.stringify(message)}\n`); });
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let chain = Promise.resolve();
  const drainLines = () => {
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      chain = chain.then(() => agent.handle(line));
      newline = buffer.indexOf("\n");
    }
  };
  for await (const chunk of input) {
    buffer += typeof chunk === "string" ? chunk : decoder.write(Buffer.from(chunk));
    drainLines();
  }
  buffer += decoder.end();
  drainLines();
  if (buffer.trim()) chain = chain.then(() => agent.handle(buffer));
  await chain;
}
