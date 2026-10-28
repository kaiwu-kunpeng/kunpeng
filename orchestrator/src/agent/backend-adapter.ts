import { isAbsolute, delimiter } from "node:path";
import { extractTokensUsed } from "../util/extract-tokens.js";
import { codexMcpArgs } from "./codex-mcp-args.js";
import { parseCodexJsonl } from "./codex-json-parse.js";
import { outputSchemaArgs } from "./output-schema.js";

export interface AdapterRoute { model?: string; effort?: string; outputSchemaPath?: string; writableRoots?: string[]; }
export interface AdapterInvocation { bin: string; args: string[]; promptVia: "stdin" | "argv"; }
export interface ParsedOutput { text: string; tokens?: number; }

/** 一个后端模型提供方的适配器。加新后端(codex/claude/qwen/local…)= 实现并注册一个本接口,
 *  无需改路由/cli-runner/总览。kind 预留:cli=子进程;http=未来 API 后端(本期只实现 cli)。 */
export interface BackendAdapter {
  name: string;
  kind: "cli" | "http";
  /** 该后端认证/运行所需的环境变量名——launchd 极简环境据此烤进 env(codex 要 HOME;claude 还要 USER/LOGNAME 取 Keychain)。 */
  authEnv: string[];
  /** 构造子进程调用(不含 prompt;prompt 按 promptVia 经 stdin/argv 传)。 */
  invoke(route: AdapterRoute, tools: string[], mcpConfigPath?: string): AdapterInvocation;
  /** 构造流式子进程调用；未实现时调用方可回退到 invoke。 */
  invokeStream?(route: AdapterRoute, tools: string[], mcpConfigPath?: string): AdapterInvocation;
  /** 解析子进程输出 → 正文 + token 数(各家格式不同:claude json usage / codex `tokens used` 横幅)。 */
  parseOutput(stdout: string, stderr: string): ParsedOutput;
}

const wantsWeb = (tools: string[]) => tools.some((t) => /websearch|web-search|webfetch/i.test(t));
const claudeMcpArgs = (mcpConfigPath?: string) => mcpConfigPath
  ? ["--mcp-config", mcpConfigPath, "--strict-mcp-config"]
  : [];

/** claude:prompt 走 stdin(--output-format json 便于取 usage),Keychain 认证需 USER/LOGNAME。 */
export const claudeAdapter: BackendAdapter = {
  name: "claude",
  kind: "cli",
  authEnv: ["PATH", "HOME", "USER", "LOGNAME", "SHELL"],
  invoke: (route, tools, mcpConfigPath) => ({
    bin: "claude",
    args: ["-p", "--output-format", "json", "--permission-mode", "acceptEdits",
      ...(wantsWeb(tools) ? ["--allowedTools", "WebSearch", "WebFetch"] : []),
      ...(route.model ? ["--model", route.model] : []),
      ...claudeMcpArgs(mcpConfigPath)],
    promptVia: "stdin",
  }),
  invokeStream: (route, tools, mcpConfigPath) => ({
    bin: "claude",
    args: ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "acceptEdits",
      ...(wantsWeb(tools) ? ["--allowedTools", "WebSearch", "WebFetch"] : []),
      ...(route.model ? ["--model", route.model] : []),
      ...claudeMcpArgs(mcpConfigPath)],
    promptVia: "stdin",
  }),
  parseOutput: (stdout, stderr) => {
    try {
      const j = JSON.parse(stdout) as { result?: unknown; usage?: { input_tokens?: number; output_tokens?: number } };
      if (typeof j.result === "string") {
        const tokens = (j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0);
        return { text: j.result, tokens: tokens > 0 ? tokens : undefined };
      }
    } catch { /* 非 json(未登录/报错)→回退文本 */ }
    const text = `${stdout}${stderr}`;
    return { text, tokens: extractTokensUsed(text) };
  },
};

let warnedUnsandboxed = false;

/** codex:prompt 走 stdin,文件认证只需 HOME;stdout 用 --json 的 JSONL 结构化解析。 */
export const codexAdapter: BackendAdapter = {
  name: "codex",
  kind: "cli",
  authEnv: ["PATH", "HOME"],
  invoke: (route, tools, mcpConfigPath) => {
    const mcpArgs = codexMcpArgs(mcpConfigPath);
    if (process.env.KUNPENG_CODEX_UNSANDBOXED === "1" && !warnedUnsandboxed) {
      warnedUnsandboxed = true;
      console.warn("KUNPENG_CODEX_UNSANDBOXED 已废除，codex 一律使用 workspace-write 沙箱");
    }
    const writableRoots = [...new Set([
      ...(process.env.KUNPENG_CODEX_WRITABLE_ROOTS ?? "").split(delimiter),
      ...(route.writableRoots ?? []),
    ]
      .map((p) => p.trim())
      .filter((p) => p !== "" && isAbsolute(p)))];
    return {
      bin: "codex",
      args: ["exec", "--json", "--sandbox", "workspace-write",
        "--skip-git-repo-check",
        ...(wantsWeb(tools) || process.env.KUNPENG_CODEX_NETWORK === "1"
          ? ["-c", "sandbox_workspace_write.network_access=true"] : []),
        ...writableRoots.flatMap((p) => ["--add-dir", p]),
        ...(wantsWeb(tools) ? ["-c", "tools.web_search=true"] : []),
        ...(route.model ? ["-m", route.model] : []),
        ...(route.effort ? ["-c", `model_reasoning_effort=${route.effort}`] : []),
        ...outputSchemaArgs(route.outputSchemaPath),
        ...mcpArgs,
        ...(process.env.KUNPENG_CODEX_STRICT_MCP === "1" && mcpArgs.length > 0
          ? ["--ignore-user-config"]
          : [])],
      promptVia: "stdin",
    };
  },
  invokeStream: (route, tools, mcpConfigPath) => codexAdapter.invoke(route, tools, mcpConfigPath),
  parseOutput: (stdout, stderr) => {
    const json = parseCodexJsonl(stdout);
    if (json.text || json.tokens > 0) {
      return { text: json.text, tokens: json.tokens > 0 ? json.tokens : undefined };
    }

    const text = `${stdout}${stderr}`;
    return { text, tokens: extractTokensUsed(text) };
  },
};

const REGISTRY = new Map<string, BackendAdapter>([
  [claudeAdapter.name, claudeAdapter],
  [codexAdapter.name, codexAdapter],
]);

/** 注册(或覆盖)一个后端 adapter——未来加 qwen/local/视频在别处调它即可。 */
export function registerAdapter(adapter: BackendAdapter): void {
  REGISTRY.set(adapter.name, adapter);
}

/** 取 adapter;未注册返回 undefined(调用方决定回退/报错)。 */
export function getAdapter(name: string): BackendAdapter | undefined {
  return REGISTRY.get(name);
}

/** 列出所有已注册后端名。 */
export function listAdapters(): string[] {
  return [...REGISTRY.keys()];
}
