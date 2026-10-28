import { agoText, deriveLight } from "./derive-light.js";
import type { Category, ModuleDef, ModuleStatus, StatusContext } from "./types.js";

const STALE_MS = 7 * 86400_000;

interface ModuleInput {
  hasActivity: boolean;
  at?: number;
  summary?: string;
  lastOk?: boolean;
  pending?: number;
  heartbeat?: { online: boolean; detail: string };
  note?: string;
}

function latestTimestamp(values: (number | undefined)[]): number | undefined {
  const timestamps = values.filter((value): value is number => typeof value === "number");
  if (timestamps.length === 0) return undefined;
  return Math.max(...timestamps);
}

function heartbeat(online: boolean | undefined, label: string): { online: boolean; detail: string } {
  const isOnline = online ?? false;
  return { online: isOnline, detail: `${label}${isOnline ? "在线" : "离线"}` };
}

function tidyRunText(text: string | undefined, now: number): string | undefined {
  if (!text) return undefined;
  return text.replace(/@(\d{10,})/g, (_, ms) => `(${agoText(now - Number(ms))})`);
}

function defineModule(
  id: string,
  name: string,
  category: Category,
  read: (ctx: StatusContext) => ModuleInput,
): ModuleDef {
  return {
    id,
    name,
    category,
    derive: (ctx) => {
      const input = read(ctx);
      const wired = ctx.wired[id] ?? false;
      const stale = input.at === undefined ? false : ctx.now - input.at > STALE_MS;
      const status: ModuleStatus = {
        id,
        name,
        category,
        wired,
        light: deriveLight({
          wired,
          hasActivity: input.hasActivity,
          lastOk: input.lastOk,
          pending: input.pending,
          stale,
        }),
      };
      if (input.at !== undefined) {
        status.lastActivity = {
          at: input.at,
          agoText: agoText(ctx.now - input.at),
          summary: input.summary ?? `${name}有活动`,
          ...(input.lastOk === undefined ? {} : { ok: input.lastOk }),
        };
      }
      if (input.heartbeat) status.heartbeat = input.heartbeat;
      if (input.note) status.note = input.note;
      return status;
    },
  };
}

export const MODULE_REGISTRY: ModuleDef[] = [
  defineModule("switchboard", "跨实例通讯", "comms", (ctx) => ({
    hasActivity: ctx.switchboard?.lastAt !== undefined,
    at: ctx.switchboard?.lastAt,
    summary: ctx.switchboard?.lastFrom ? `最近来自 ${ctx.switchboard.lastFrom}` : "最近收到跨实例消息",
    pending: ctx.switchboard?.unread ?? 0,
    heartbeat: heartbeat(ctx.online?.["switchboard"], "switchboard"),
  })),
  defineModule("notify", "手机通知", "comms", (ctx) => {
    const n = ctx.notify;
    const allFailed = (r?: { sent: string[]; failed: string[] }) => r !== undefined && r.failed.length > 0 && r.sent.length === 0;
    const at = latestTimestamp([n?.lastSentAt, n?.heartbeat?.at, n?.scan?.at]);
    const everSent = n?.lastSentAt !== undefined || (n?.heartbeat?.sent.length ?? 0) > 0 || (n?.scan?.sent.length ?? 0) > 0;
    const lastOk = allFailed(n?.scan) || allFailed(n?.heartbeat) ? false : everSent ? true : undefined;
    const summary = n?.scan
      ? `最近扫描 ${n.scan.candidates} 个候选${n.scan.sent.length ? `，已推 ${n.scan.sent.join("/")}` : n.scan.failed.length ? `，推送失败 ${n.scan.failed.join("/")}` : n.scan.skipped ? `（${n.scan.skipped}）` : ""}`
      : "最近手机推送";
    return {
      hasActivity: at !== undefined,
      at,
      summary,
      ...(lastOk === undefined ? {} : { lastOk }),
      ...(n?.configured === false ? { note: "未配置通知通道（~/.kunpeng/notify.json）" } : {}),
    };
  }),
  defineModule("knowledge-inbox", "知识捕获", "research-loop", (ctx) => {
    const at = latestTimestamp([ctx.artifactLatest["url"], ctx.artifactLatest["text"]]);
    return { hasActivity: at !== undefined, at, summary: "最近知识捕获" };
  }),
  defineModule("evolution-flywheel", "自进化飞轮", "research-loop", (ctx) => ({
    hasActivity: Boolean(ctx.evolution?.lastRunText),
    pending: ctx.evolution?.pendingCount ?? 0,
    note: tidyRunText(ctx.evolution?.lastRunText, ctx.now),
  })),
  defineModule("perf-loop", "性能优化循环", "research-loop", (ctx) => ({
    hasActivity: ctx.artifactLatest["pri"] !== undefined,
    at: ctx.artifactLatest["pri"],
    summary: "最近性能优化记录",
  })),
  defineModule("best-of-n", "多候选选优", "research-loop", (ctx) => {
    const active = ctx.branches.some((branch) => branch.startsWith("kp/bon-"));
    return {
      hasActivity: active,
      at: active ? ctx.artifactLatest["spec"] : undefined,
      summary: "发现 best-of-N 候选分支",
    };
  }),
  defineModule("guardian", "自愈 reconcile", "ops", (ctx) => ({
    hasActivity: ctx.artifactLatest["merge"] !== undefined,
    at: ctx.artifactLatest["merge"],
    summary: "最近合并/自愈痕迹",
  })),
  defineModule("watchdog", "卡死/长跑告警", "ops", (ctx) => ({
    hasActivity: ctx.health.running > 0 || ctx.health.alerts.length > 0,
    pending: ctx.health.alerts.length,
    heartbeat: heartbeat(ctx.online?.["watchdog"], "watchdog"),
  })),
  defineModule("patrol", "提案巡检", "ops", (ctx) => ({
    hasActivity: ctx.patrol !== undefined,
    pending: ctx.patrol?.pendingCount ?? 0,
    note: tidyRunText(ctx.patrol?.lastRunText, ctx.now),
  })),
  defineModule("product-track", "产品轨 DEFINE", "research-loop", (ctx) => ({
    hasActivity: ctx.artifactLatest["form"] !== undefined,
    at: ctx.artifactLatest["form"],
    summary: "最近产品表单",
  })),
  defineModule("merge-gate", "合并审查闸", "governance", (ctx) => ({
    hasActivity: ctx.artifactLatest["merge"] !== undefined,
    at: ctx.artifactLatest["merge"],
    summary: "最近合并审查",
  })),
  defineModule("dev-cycle", "核心研发循环", "research-loop", (ctx) => {
    const latest = ctx.flows.reduce<(typeof ctx.flows)[number] | undefined>((current, flow) => {
      if (!current || flow.updatedAt > current.updatedAt) return flow;
      return current;
    }, undefined);
    return {
      hasActivity: ctx.flows.length > 0,
      at: latest?.updatedAt,
      summary: latest ? `最近流 ${latest.stage}/${latest.status}` : "最近研发循环",
      lastOk: latest ? latest.status !== "crashed" : undefined,
      pending: ctx.flows.filter((flow) => flow.status === "running").length,
    };
  }),
  defineModule("plan-orchestrator", "方案编排", "research-loop", (ctx) => ({
    hasActivity: ctx.artifactLatest["plan"] !== undefined,
    at: ctx.artifactLatest["plan"],
    summary: "最近方案产物",
  })),
  defineModule("design-codegen", "设计/出码", "research-loop", (ctx) => ({
    hasActivity: ctx.artifactLatest["design-selection"] !== undefined,
    at: ctx.artifactLatest["design-selection"],
    summary: "最近设计候选裁决",
  })),
  defineModule("research", "研究", "research-loop", (ctx) => {
    const at = latestTimestamp([ctx.artifactLatest["network"], ctx.artifactLatest["connector"]]);
    return { hasActivity: at !== undefined, at, summary: "最近研究产出" };
  }),
  defineModule("security-review", "安全审查", "governance", () => ({
    hasActivity: false,
  })),
  defineModule("compile", "AGENTS.md 编译", "governance", (ctx) => ({
    hasActivity: ctx.mtimes?.["agents-md"] !== undefined,
    at: ctx.mtimes?.["agents-md"],
    summary: "最近 AGENTS.md 编译产物",
  })),
  defineModule("usage", "用量度量", "platform", (ctx) => ({
    hasActivity: Boolean(ctx.quota && ctx.quota.total > 0),
    lastOk: ctx.quota && ctx.quota.total > 0 ? true : undefined,
    note: ctx.quota ? `total=${ctx.quota.total}, accounts=${ctx.quota.accounts.length}` : undefined,
  })),
  defineModule("board", "跨端看板", "platform", (ctx) => ({
    hasActivity: ctx.mtimes?.["board"] !== undefined,
    at: ctx.mtimes?.["board"],
    summary: "最近看板刷新",
  })),
  defineModule("serve", "总控台服务", "platform", (ctx) => ({
    hasActivity: ctx.online?.["serve"] === true,
    heartbeat: heartbeat(ctx.online?.["serve"], "serve"),
  })),
];
