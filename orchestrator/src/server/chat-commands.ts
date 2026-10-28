export interface ChatCommand {
  name: string;
  usage: string;
  description: string;
}

export interface GateCardData {
  id: string;
  planId: string | null;
  kind: "merge" | "human";
  title: string;
  branch: string | null;
  project: { id: string; name: string };
  createdAt: number | null;
}

export interface GateCardSnapshot {
  id: string;
  name: string;
  state: {
    humanGates?: Array<{ what: string; detail: string; flowId: string }>;
    flows?: Array<{ flowId: string; planId?: string; startedAt: number }>;
  };
}

export const CHAT_COMMANDS: ChatCommand[] = [
  { name: "help", usage: "/help", description: "查看全部聊天命令" },
  { name: "loop", usage: "/loop <需求>", description: "把需求加入自建开发循环" },
  { name: "ask", usage: "/ask <问题>", description: "本轮临时切换到 Plan 模式" },
  { name: "code", usage: "/code <任务>", description: "本轮临时切换到 Act 模式" },
  { name: "act", usage: "/act <任务>", description: "本轮临时切换到 Act 模式" },
  { name: "model", usage: "/model <name>", description: "切换当前会话使用的模型" },
  { name: "cost", usage: "/cost", description: "查看当前会话累计 token 与费用" },
  { name: "status", usage: "/status", description: "查看当前会话模型、模式与轮数" },
  { name: "gates", usage: "/gates", description: "列出待审人工门,卡片上直接批/驳" },
  { name: "skills", usage: "/skills [keyword]", description: "搜索已启用的技能" },
  { name: "skill", usage: "/skill <id> [任务]", description: "查看技能或按技能执行任务" },
  { name: "capture", usage: "/capture", description: "把最后一轮助手回复存入知识库" },
  { name: "compact", usage: "/compact", description: "压缩当前会话上下文并从摘要继续" },
  { name: "clear", usage: "/clear", description: "说明如何新建会话且保留历史" },
  { name: "web", usage: "/web <on|off>", description: "切换聊天窗口的联网搜索" },
  { name: "open", usage: "/open <相对路径>", description: "在浏览器中打开工作区文件" },
  { name: "files", usage: "/files [目录]", description: "浏览工作区文件并提供下载" },
  { name: "stop", usage: "/stop", description: "中断当前聊天生成" },
];

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}

/** 把首页收件箱同源的 humanGates 与 flow 真相拼成对话卡片数据。 */
export function gateCardsFromSnapshots(snapshots: GateCardSnapshot[]): GateCardData[] {
  return snapshots.flatMap((snapshot) => {
    const flows = new Map((snapshot.state.flows ?? []).map((flow) => [flow.flowId, flow]));
    return (snapshot.state.humanGates ?? []).map((gate) => {
      const flow = flows.get(gate.flowId);
      return {
        id: gate.flowId,
        planId: flow?.planId ?? null,
        kind: gate.what.includes("合并") ? "merge" as const : "human" as const,
        title: gate.what || gate.detail,
        branch: flow ? `kp/${flow.flowId}` : null,
        project: { id: snapshot.id, name: snapshot.name },
        createdAt: flow?.startedAt ?? null,
      };
    });
  });
}

/** 属性值只放完整 JSON 的 HTML 转义形态，绝不拼接未转义字段。 */
export function renderGateCardsReply(cards: GateCardData[]): string {
  if (cards.length === 0) return "当前没有待审门 ✅";
  return cards.map((card) => {
    const data = escapeAttribute(JSON.stringify(card));
    return `<div class="kp-ev kp-loop-card" data-gate-card="${data}"></div>`;
  }).join("\n");
}

/** /gates 入库用纯文本形态,与 renderGateCardsReply 的空态逐字一致,非空时不含任何标签。 */
export function gateCardsText(cards: GateCardData[]): string {
  if (cards.length === 0) return "当前没有待审门 ✅";
  const lines = cards.map((card) => {
    const suffix = card.branch ? ` (${card.branch})` : "";
    return `- [${card.project.name}] ${card.title}${suffix}`;
  });
  return [`待审门 ${cards.length} 个:`, ...lines].join("\n");
}

export function matchChatCommand(message: string): { name: string; rest: string } | null {
  const matched = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(message.trim());
  if (!matched) return null;
  const name = matched[1].toLowerCase();
  if (!CHAT_COMMANDS.some((command) => command.name === name)) return null;
  return {
    name,
    rest: (matched[2] ?? "").trim(),
  };
}
