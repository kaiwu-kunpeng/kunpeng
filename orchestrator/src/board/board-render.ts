export interface BoardInput {
  project: { id: string; name: string; repoPath: string };
  systemLight: "red" | "yellow" | "green";
  activeFlows: { flowId: string; stage: string; requirement: string }[];
  plans: { id: string; status: string; merged: boolean; desc: string }[];
  humanGates: { what: string; detail: string }[];
  blockers: { flowId: string; reason: string }[];
  passedLines: number;
}

export interface Board extends BoardInput {
  schema: "kunpeng-board/v1";
  generatedAt: number;
}

export function renderBoardJson(input: BoardInput, generatedAt: number): Board {
  return {
    ...input,
    schema: "kunpeng-board/v1",
    generatedAt,
  };
}

export function renderBoardMarkdown(board: Board): string {
  const lines: string[] = [];

  lines.push(`# 项目看板 · ${board.project.name} (${board.project.id})`);
  lines.push("");
  lines.push("工具无关状态面 kunpeng-board/v1，任何 agent 可读");
  lines.push("");
  lines.push(`系统灯：${board.systemLight}`);
  lines.push("");

  // 活跃开发流
  lines.push("## 活跃开发流");
  if (board.activeFlows.length === 0) {
    lines.push("（无）");
  } else {
    for (const flow of board.activeFlows) {
      lines.push(`- [${flow.flowId}] ${flow.stage}: ${flow.requirement}`);
    }
  }
  lines.push("");

  // 方案进度
  lines.push("## 方案进度");
  if (board.plans.length === 0) {
    lines.push("（无）");
  } else {
    for (const plan of board.plans) {
      lines.push(
        `- [${plan.id}] ${plan.desc} (${plan.status}${plan.merged ? ", 已合并" : ""})`
      );
    }
  }
  lines.push("");

  // 需人工
  lines.push("## 需人工");
  if (board.humanGates.length === 0) {
    lines.push("（无）");
  } else {
    for (const gate of board.humanGates) {
      lines.push(`- ${gate.what}: ${gate.detail}`);
    }
  }
  lines.push("");

  // 卡点
  lines.push("## 卡点");
  if (board.blockers.length === 0) {
    lines.push("（无）");
  } else {
    for (const blocker of board.blockers) {
      lines.push(`- [${blocker.flowId}] ${blocker.reason}`);
    }
  }
  lines.push("");

  lines.push(`已过审代码 ${board.passedLines} 行`);

  return lines.join("\n");
}
