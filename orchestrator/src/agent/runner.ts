export type Stage = "spec" | "design" | "implement" | "review" | "verify" | "audit";

export interface AgentRequest {
  stage: Stage;
  system: string;
  input: string;
  tools: string[];
  cwd?: string;
  model?: string;
  /** 范围门 allow globs；Claude 后端据此挂载 PreToolUse 运行时拦截。 */
  scopeAllow?: string[];
  /** 出差模式等场景下要施加给 agent 的主机工具 deny 规则（裸工具名）。 */
  hostDeny?: string[];
  /** 有值时整段替换 stage 自带角色指令并省掉 `# Stage` 行，用于研究等非流水线调用——
   *  避免 stage="spec" 的「写 spec」角色指令劫持联网调研。空串视同没有。 */
  instructionOverride?: string;
  /** 评估类调用避开实现者后端；CliRunner 优先选另一后端，仅一个可用时退回同后端并记一行提示；FakeRunner 忽略。 */
  avoidBackend?: "claude" | "codex";
  signal?: AbortSignal;
  onSpawn?: (pid: number) => void;
}

export interface AgentResult { text: string; meta: Record<string, unknown>; backend?: string; fellBack?: boolean; modelUsed?: string; chain?: string[]; }

export interface AgentRunner { run(req: AgentRequest): Promise<AgentResult>; }

/** 测试用：按 stage 返回预设结果，不调任何 LLM。 */
export class FakeRunner implements AgentRunner {
  constructor(private scripted: Partial<Record<Stage, AgentResult>>) {}
  async run(req: AgentRequest): Promise<AgentResult> {
    const r = this.scripted[req.stage];
    if (!r) throw new Error(`no scripted result for stage: ${req.stage}`);
    return r;
  }
}
