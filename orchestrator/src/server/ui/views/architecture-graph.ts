import type { DashboardState } from "../../state.js";

export type ArchState = "running" | "idle" | "waiting" | "done" | "failed";
export type ArchLayer = 0 | 1 | 2 | 3 | 4;

export const ARCH_LAYER_LABELS = ["入口层", "编排层", "引擎层", "数据·记忆层", "外部执行层"];

export const ARCH_MODULE_IDS: Record<string, string> = {
  switchboard: "switchboard",
  guardian: "guardian",
  patrol: "patrol",
  compile: "compile",
  gate1: "merge-gate",
  plan: "plan-orchestrator",
  drive: "evolution-flywheel",
  audit: "security-review",
};

/** 节点不再带 x/y——客户端用 ELK(cytoscape-elk) 自动布局,删死坐标。cluster 决定配色,metric 是节点上的活指标。 */
export interface ArchNode {
  id: string;
  label: string;
  cluster: "core" | "harness" | "observe" | "security" | "flywheel" | "evolution" | "cross";
  classes: string[];
  state: ArchState;
  layer: ArchLayer;
  moduleId?: string;
  badge?: number;       // 计数徽标(如待门数/在跑数)
  metric?: string;      // 活指标文字(如 token 数/行数),无则不显
  detail?: string;      // 点击下钻时的说明
  route?: string;       // 可下钻到的真实面板路由
}

export interface ArchEdge {
  source: string;
  target: string;
  classes: string[];
  feedback?: boolean;
}

export interface ArchGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
}

function node(
  n: { id: string; label: string; cluster: ArchNode["cluster"]; layer: ArchLayer; extra?: string[]; moduleId?: string; badge?: number; metric?: string; detail?: string; route?: string },
  state: ArchState,
): ArchNode {
  const moduleId = n.moduleId ?? ARCH_MODULE_IDS[n.id];
  return {
    id: n.id,
    label: n.label,
    cluster: n.cluster,
    state,
    layer: n.layer,
    classes: [`c-${n.cluster}`, `s-${state}`, ...(n.extra ?? [])],
    ...(moduleId ? { moduleId } : {}),
    ...(n.badge !== undefined ? { badge: n.badge } : {}),
    ...(n.metric ? { metric: n.metric } : {}),
    ...(n.detail ? { detail: n.detail } : {}),
    ...(n.route ? { route: n.route } : {}),
  };
}

function appendModuleMetric(metric: string | undefined, label: "模块红" | "模块黄"): string {
  return `${metric ?? ""}｜${label}`;
}

function withStateClass(classes: string[], state: ArchState): string[] {
  return classes.map((className) => className.startsWith("s-") ? `s-${state}` : className);
}

function stageState(stage: string, blocked: Set<unknown>, running: Set<unknown>): ArchState {
  if (blocked.has(stage)) return "failed";
  if (running.has(stage)) return "running";
  return "idle";
}

/** 从实时 DashboardState 派生当前系统的架构图(七簇:核心 loop / harness / 观测 / 安全 / 飞轮 / 自进化 / 跨实例)。
 *  节点尽量挂真实状态与活指标——真实体现系统情况,而非写死的概念图。 */
export function buildArchitectureGraph(state: DashboardState): ArchGraph {
  const s = state ?? ({} as DashboardState);
  const running = s.running ?? [];
  const blocked = new Set((s.blockers ?? []).map((b) => b.stage));
  const runningStages = new Set(running.map((r) => r.stage));
  const mergeGates = (s.humanGates ?? []).filter((g) => (g.what ?? "").includes("合并")).length;
  const patrolPending = s.patrol?.pendingCount ?? 0;
  const reinjectBadge = s.reinjectBacklog?.pending ?? 0;
  const runningCount = running.length;
  const totalTokens = s.costSummary?.totalTokens ?? 0;
  const srcLines = s.code?.srcLines ?? 0;
  const testLines = s.code?.testLines ?? 0;
  const completed = s.code?.completed ?? 0;
  const sysFailed = s.systemLight === "red";
  const fmtK = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

  const nodes: ArchNode[] = [
    // ── 核心 loop ──
    node({ id: "plan", label: "Plan 编排", cluster: "core", layer: 1, extra: ["orchestrate"], badge: runningCount, metric: `${runningCount} 在跑`, detail: "多流并发编排,按段顺序集成进 plan 分支" }, runningCount > 0 ? "running" : "idle"),
    node({ id: "need", label: "需求/方案", cluster: "core", layer: 0, extra: ["entry"], detail: "新任务入口:需求→spec" }, runningCount > 0 ? "running" : "idle"),
    node({ id: "spec", label: "Spec", cluster: "core", layer: 2, extra: ["stage"], detail: "规约阶段:产出验收标准+锁定验收测试(注入代码地图/记忆)" }, stageState("spec", blocked, runningStages)),
    node({ id: "impl", label: "Implement", cluster: "core", layer: 2, extra: ["stage"], detail: "实现阶段:codex/claude 写代码满足验收" }, stageState("implement", blocked, runningStages)),
    node({ id: "verify", label: "Verify", cluster: "core", layer: 2, extra: ["stage"], detail: "真验证:跑验收测试+差分门(只拦基线外新错)" }, stageState("verify", blocked, runningStages)),
    node({ id: "gate1", label: "门#1 合并主干", cluster: "core", layer: 2, extra: ["gate"], badge: mergeGates, metric: mergeGates > 0 ? `${mergeGates} 待审` : "畅通", detail: "人工合并门:范围门+冲突诊断", route: "#/inbox" }, mergeGates > 0 ? "waiting" : "idle"),
    node({ id: "main", label: "main 主干", cluster: "core", layer: 3, extra: ["terminal"], metric: `${fmtK(srcLines + testLines)} 行 · ${completed} 交付`, detail: "规范代码状态真相源(读 ref 不读工作树)", route: "#/tasks" }, sysFailed ? "failed" : "done"),

    // ── harness 脊柱(S2) ──
    node({ id: "checkpoint", label: "Checkpoint 每阶段", cluster: "harness", layer: 2, metric: "kp-ckpt tag", detail: "每阶段提交+打 tag,崩溃可从 checkpoint 恢复 worktree 续跑" }, "idle"),
    node({ id: "pauseResume", label: "Pause / Resume", cluster: "harness", layer: 2, detail: "阶段边界优雅暂停(标记)+从 checkpoint 续跑(跳过已完成 implement)" }, "idle"),

    // ── 观测 ──
    node({ id: "escapeRate", label: "逃逸率", cluster: "observe", layer: 3, detail: "合并后被回滚/还原占比,量化合并门拦截力(见概览面板)" }, "idle"),
    node({ id: "cost", label: "成本/Token", cluster: "observe", layer: 3, metric: `${fmtK(totalTokens)} tok`, detail: "按价格×token 聚合成本归因", route: "#/overview" }, "idle"),
    node({ id: "span", label: "GenAI Span", cluster: "observe", layer: 3, metric: "gen_ai.*", detail: "每 stage 用量产出 OTel gen_ai.* span 落 flow 日志" }, "idle"),

    // ── 安全闭环(S5) ──
    node({ id: "audit", label: "漏洞扫描", cluster: "security", layer: 2, detail: "npm audit→可修复性分桶(非major可自动/major需审)" }, "idle"),
    node({ id: "autofix", label: "自动修复", cluster: "security", layer: 2, detail: "隔离 worktree 跑 npm audit fix→真验证(install+typecheck)" }, "idle"),
    node({ id: "provenance", label: "签名存证", cluster: "security", layer: 3, detail: "修复前后漏洞数+provenance 记录,主仓验证前不动" }, "idle"),

    // ── 飞轮 backlog ──
    node({ id: "guardian", label: "Guardian 扫描", cluster: "flywheel", layer: 1, detail: "守护扫描 typecheck/lint/TODO→发现" }, "idle"),
    node({ id: "reinject", label: "Reinject 队列", cluster: "flywheel", layer: 1, badge: reinjectBadge, metric: reinjectBadge > 0 ? `${reinjectBadge} 待办` : "空", detail: "发现去重落 backlog 待驱动消费", route: "#/overview" }, reinjectBadge > 0 ? "waiting" : "idle"),
    node({ id: "drive", label: "Drive 驱动", cluster: "flywheel", layer: 1, detail: "从 backlog 取需求喂 DevCycle" }, "idle"),

    // ── 自进化 ──
    node({ id: "experience", label: "Experience", cluster: "evolution", layer: 3, detail: "经验沉淀:成功/回滚结果留痕" }, "idle"),
    node({ id: "patrol", label: "Patrol 蒸馏", cluster: "evolution", layer: 1, badge: patrolPending, detail: "巡检蒸馏→候选改进提案", route: "#/evolution" }, patrolPending > 0 ? "waiting" : "idle"),
    node({ id: "gate2", label: "门#2 改宪法", cluster: "evolution", layer: 2, extra: ["gate"], badge: patrolPending, metric: patrolPending > 0 ? `${patrolPending} 待审` : "畅通", detail: "自进化人门:代码根因否决,只过真改进" }, patrolPending > 0 ? "waiting" : "idle"),
    node({ id: "apply", label: "Apply 落地", cluster: "evolution", layer: 2, detail: "批准的提案落地" }, "idle"),
    node({ id: "compile", label: "Compile→AGENTS", cluster: "evolution", layer: 2, detail: "编译规约→全项目 AGENTS.md 传播" }, "idle"),

    // ── 跨实例 ──
    node({ id: "switchboard", label: "Switchboard 跨实例", cluster: "cross", layer: 0, detail: "多 chat/实例通讯+开工避让+stop 指令", route: "#/switchboard" }, "idle"),

    // ── 外部执行 ──
    node({ id: "claudeCli", label: "Claude CLI", cluster: "cross", layer: 4, detail: "实现与评审阶段的外部模型执行器" }, "idle"),
    node({ id: "codexCli", label: "Codex CLI", cluster: "cross", layer: 4, detail: "实现与评审阶段的外部模型执行器" }, "idle"),
    node({ id: "mcp", label: "MCP 工具", cluster: "cross", layer: 4, detail: "受控外部工具与数据连接" }, "idle"),
    node({ id: "git", label: "Git", cluster: "harness", layer: 4, detail: "工作树、提交、标签与主干合并" }, "idle"),
    node({ id: "deploy", label: "部署", cluster: "security", layer: 4, detail: "经发布人工门后的外部部署" }, "idle"),
  ];

  const rawEdges: ArchEdge[] = [
    // 核心 loop
    { source: "need", target: "spec", classes: ["main"] },
    { source: "spec", target: "impl", classes: ["main"] },
    { source: "impl", target: "verify", classes: ["main"] },
    { source: "verify", target: "gate1", classes: ["main"] },
    { source: "gate1", target: "main", classes: ["main"] },
    { source: "verify", target: "spec", classes: ["repair"], feedback: true },
    { source: "plan", target: "spec", classes: ["orchestrate"] },
    // harness 挂在 implement/verify 之间
    { source: "impl", target: "checkpoint", classes: ["harness"] },
    { source: "checkpoint", target: "verify", classes: ["harness"] },
    { source: "pauseResume", target: "checkpoint", classes: ["harness"] },
    // 观测从 main/verify 引出
    { source: "main", target: "escapeRate", classes: ["observe"] },
    { source: "main", target: "cost", classes: ["observe"] },
    { source: "verify", target: "span", classes: ["observe"] },
    // 安全闭环:main→扫描→修复→(回 verify 真验证)→存证
    { source: "main", target: "audit", classes: ["security"] },
    { source: "audit", target: "autofix", classes: ["security"] },
    { source: "autofix", target: "verify", classes: ["security"], feedback: true },
    { source: "autofix", target: "provenance", classes: ["security"] },
    // 飞轮环
    { source: "main", target: "guardian", classes: ["flywheel"] },
    { source: "guardian", target: "reinject", classes: ["flywheel"] },
    { source: "reinject", target: "drive", classes: ["flywheel"] },
    { source: "drive", target: "spec", classes: ["flywheel"] },
    // 自进化环
    { source: "main", target: "experience", classes: ["evolution"] },
    { source: "experience", target: "patrol", classes: ["evolution"] },
    { source: "patrol", target: "gate2", classes: ["evolution"] },
    { source: "gate2", target: "apply", classes: ["evolution"] },
    { source: "apply", target: "compile", classes: ["evolution"] },
    { source: "compile", target: "spec", classes: ["evolution"], feedback: true },
    // 跨实例协调编排
    { source: "switchboard", target: "plan", classes: ["cross"] },
    // 引擎驱动外部执行
    { source: "impl", target: "claudeCli", classes: ["cross"] },
    { source: "impl", target: "codexCli", classes: ["cross"] },
    { source: "verify", target: "mcp", classes: ["cross"] },
    { source: "gate1", target: "git", classes: ["harness"] },
    { source: "main", target: "deploy", classes: ["security"] },
  ];

  const layerById = new Map(nodes.map((archNode) => [archNode.id, archNode.layer]));
  const edges = rawEdges.map((edge) => {
    const sourceLayer = layerById.get(edge.source);
    const targetLayer = layerById.get(edge.target);
    return edge.feedback || (sourceLayer !== undefined && targetLayer !== undefined && sourceLayer > targetLayer)
      ? { ...edge, feedback: true }
      : edge;
  });

  if (!s.moduleStatus) return { nodes, edges };

  const modulesById = new Map(s.moduleStatus.modules.map((module) => [module.id, module]));
  const nodesWithModuleLights = nodes.map((archNode) => {
    const moduleId = ARCH_MODULE_IDS[archNode.id];
    if (!moduleId) return archNode;
    const moduleStatus = modulesById.get(moduleId);
    if (!moduleStatus) return archNode;
    if (moduleStatus.light === "red") {
      return {
        ...archNode,
        state: "failed" as const,
        classes: withStateClass(archNode.classes, "failed"),
        metric: appendModuleMetric(archNode.metric, "模块红"),
      };
    }
    if (moduleStatus.light === "yellow") {
      return { ...archNode, metric: appendModuleMetric(archNode.metric, "模块黄") };
    }
    return archNode;
  });

  return { nodes: nodesWithModuleLights, edges };
}
