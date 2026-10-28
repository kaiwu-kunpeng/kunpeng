import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { registerAgent } from "../agent/agent-registry.js";
import { flushOutbox, listOutbox, type OutboxPayload } from "../loop/outbox.js";
import { submitIndexNow } from "../seo/indexnow.js";
import { kunpengStateDir } from "../project/registry.js";
import { runSignalCommand } from "../runtime/signal-cli.js";
import { findEscalations } from "../switchboard/escalation.js";
import { resolveIdentity } from "../switchboard/identity.js";
import { formatKickoffBody } from "../switchboard/kickoff.js";
import { runMcpStdio } from "../switchboard/mcp-server.js";
import { switchboardMcpDeps } from "../switchboard/mcp-wiring.js";
import { PresenceStore } from "../switchboard/presence.js";
import { kindOf, newMessage, SwitchboardStore, type SwitchMessageKind } from "../switchboard/store.js";
import { beatPresence, findRepoRoot, presenceDir, sleep, valueAfter, withoutValuedFlags } from "./shared.js";
import { CliUsageError, registerCliCommand, type CliContext } from "./registry.js";

const SEND_USAGE = "用法: kunpeng send <to> <message...> | kunpeng send --to <to> --body <message> [--topic <t>] [--type <kind>] [--from <me>] [--urgent]";
const KICKOFF_USAGE = "用法: kunpeng kickoff <文件...> --what <做什么> [--from <me>]";

export function newSwitchMessages<T extends { id: string }>(all: T[], seenIds: Set<string>): T[] {
  return all.filter((msg) => !seenIds.has(msg.id));
}

export function parseRegisterAgentArgs(argv: readonly string[]): { pid?: number; task?: string; beatOnly?: true } {
  const pidIndex = argv.indexOf("--pid");
  const pidValue = pidIndex >= 0 ? Number(argv[pidIndex + 1]) : NaN;
  const taskIndex = argv.indexOf("--task");
  const taskValue = taskIndex >= 0 ? argv[taskIndex + 1] : undefined;

  return {
    ...(Number.isInteger(pidValue) && pidValue > 0 ? { pid: pidValue } : {}),
    ...(taskValue ? { task: taskValue } : {}),
    ...(argv.includes("--beat-only") ? { beatOnly: true as const } : {}),
  };
}

function requirePayloadValue(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") {
    throw new Error(`outbox payload missing ${name}`);
  }
  return value;
}

function switchboardIdentity(args: string[], flag: "--from" | "--as"): string {
  return resolveIdentity({ flagValue: valueAfter(args, flag), env: process.env.KUNPENG_INSTANCE, cwd: process.cwd() });
}

/** 元数据旗标（带值），解析收件人/正文时连同其值一起剥离；--urgent 无值只剥自身。 */
const SEND_META_FLAGS = new Set(["--to", "--topic", "--from", "--type", "--kind", "--as", "--subject"]);
/** 正文旗标：出现其一则其后所有 token 即正文。 */
const SEND_BODY_FLAGS = ["--body", "--msg", "--text", "--message"] as const;

/**
 * 解析 send 的参数：支持位置写法（`send <to> <body...>`）与旗标写法
 * （`--to X --body Y`、`--type kickoff <正文>`、`--from … --to all …`）。纯函数：不读盘、不看时钟、不改入参、不打印。
 */
export function parseSendArgs(rest: readonly string[]):
  | { ok: true; to: string; body: string; topic?: string; kind?: SwitchMessageKind }
  | { ok: false; error: string } {
  const args = [...rest];

  // 1. 收件人：有 --to 取其后紧邻 token；否则从左到右扫描，跳过元数据旗标（连同值）与 --urgent，取第一个非 -- 开头 token。
  let to: string | undefined;
  const toIdx = args.indexOf("--to");
  if (toIdx >= 0) {
    to = args[toIdx + 1];
  } else {
    for (let i = 0; i < args.length; i++) {
      const tok = args[i];
      if (tok === "--urgent") continue;
      if (SEND_META_FLAGS.has(tok)) { i++; continue; }
      if (tok.startsWith("--")) continue;
      to = tok;
      break;
    }
  }
  if (!to || to.startsWith("--")) {
    return { ok: false, error: "收件人缺失或非法（不要把旗标名当收件人）" };
  }

  // 2. 正文：有正文旗标 → 其后所有 token 单空格连接；否则去掉 to 那个 token 及全部元数据旗标（及其值）与 --urgent 后剩余 token。
  let bodyFlagIdx = -1;
  for (const flag of SEND_BODY_FLAGS) {
    const idx = args.indexOf(flag);
    if (idx >= 0 && (bodyFlagIdx === -1 || idx < bodyFlagIdx)) bodyFlagIdx = idx;
  }
  let body: string;
  if (bodyFlagIdx >= 0) {
    body = args.slice(bodyFlagIdx + 1).join(" ");
  } else {
    const kept: string[] = [];
    let removedTo = false;
    for (let i = 0; i < args.length; i++) {
      const tok = args[i];
      if (tok === "--urgent") continue;
      if (SEND_META_FLAGS.has(tok)) { i++; continue; }
      if (!removedTo && tok === to) { removedTo = true; continue; }
      kept.push(tok);
    }
    body = kept.join(" ");
  }
  if (body.trim() === "") {
    return { ok: false, error: "正文为空" };
  }

  // 3. topic：--topic 其后紧邻 token；缺省不带。
  const topic = valueAfter(args, "--topic");
  // 4. kind：--type/--kind 其后紧邻 token 且为合法 SwitchMessageKind 时带上；不合法/缺省则不带，不报错。
  const kindRaw = valueAfter(args, "--type") ?? valueAfter(args, "--kind");
  const kind = kindRaw !== undefined && kindOf({ kind: kindRaw }) === kindRaw ? (kindRaw as SwitchMessageKind) : undefined;

  return { ok: true, to, body, ...(topic !== undefined ? { topic } : {}), ...(kind !== undefined ? { kind } : {}) };
}

function formatSwitchMessage(msg: { from: string; topic?: string; body: string; ts: number; read: boolean; id: string }): string {
  const topicPart = msg.topic ? ` ｜ ${msg.topic}` : "";
  return `${msg.from}${topicPart} ｜ ${msg.body} ｜ ${new Date(msg.ts).toISOString()} ｜ ${msg.read ? "已读" : "未读"} ｜ ${msg.id}`;
}

registerCliCommand({
  name: "send",
  usage: SEND_USAGE,
  run: async (context: CliContext) => {
    const parsed = parseSendArgs(context.rest);
    if (!parsed.ok) {
      throw new CliUsageError(`${SEND_USAGE}\n${parsed.error}`);
    }
    const { to, body, topic, kind } = parsed;
    const from = switchboardIdentity(context.rest, "--from");

    const dir = join(kunpengStateDir(), "switchboard");
    const store = new SwitchboardStore(dir);
    const msg = newMessage(
      { from, to, topic, body, kind, urgent: context.flags.has("--urgent"), origin: { kind: "human" } },
      {
        now: Date.now,
        id: () => `msg-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      },
    );
    await store.append(msg);
    await beatPresence(from);
    console.log(`[switchboard] ${context.flags.has("--urgent") ? "🔴紧急 " : ""}已发给 ${to}：${body.slice(0, 60)}…（id ${msg.id}）`);
    return;
  },
});

registerCliCommand({
  name: "kickoff",
  usage: KICKOFF_USAGE,
  run: async (context: CliContext) => {
    const what = valueAfter(context.rest, "--what");
    const from = switchboardIdentity(context.rest, "--from");
    const files = withoutValuedFlags(context.rest, new Set(["--what", "--from"]))
      .filter((arg) => !arg.startsWith("--"));
    if (!what) {
      throw new CliUsageError(KICKOFF_USAGE);
    }

    const body = formatKickoffBody({ instance: from, files, what });
    const dir = join(kunpengStateDir(), "switchboard");
    const store = new SwitchboardStore(dir);
    const msg = newMessage(
      { from, to: "all", body },
      {
        now: Date.now,
        id: () => `msg-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      },
    );
    await store.append(msg);
    await beatPresence(from);
    console.log(`[switchboard] kickoff 已广播：${body.slice(0, 80)}…（id ${msg.id}）`);
    return;
  },
});

registerCliCommand({
  name: "signal",
  run: async (context: CliContext) => {
    // ADR-0009 打断通道：向某实例发 kind=stop 信号，对方在下一个检查点优雅停止。
    const from = switchboardIdentity(context.rest, "--from");
    const dir = join(kunpengStateDir(), "switchboard");
    const store = new SwitchboardStore(dir);
    const r = await runSignalCommand(context.rest, store, from, {
      now: Date.now,
      id: () => `sig-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    });
    if (!r.ok) {
      console.error(`[signal] ${r.error}`);
      process.exitCode = 1;
      return;
    }
    await beatPresence(from);
    console.log(`[signal] 已向 ${r.to} 发停止信号（id ${r.id}），对方下个检查点会优雅停止`);
    return;
  },
});

registerCliCommand({
  name: "inbox",
  run: async (context: CliContext) => {
    const me = switchboardIdentity(context.rest, "--as");
    const dir = join(kunpengStateDir(), "switchboard");
    const store = new SwitchboardStore(dir);
    await beatPresence(me);
    if (context.rest.includes("--watch")) {
      const parsedInterval = context.intervalArg === undefined ? 5 : Number(context.intervalArg);
      const interval = Math.max(1, Number.isFinite(parsedInterval) ? parsedInterval : 5);
      const seen = new Set<string>();
      console.log(`监听 ${me} 收件箱，每 ${interval}s 轮询，Ctrl-C 退出`);
      while (true) {
        const msgs = await store.inbox(me);
        const fresh = newSwitchMessages(msgs, seen);
        for (const msg of fresh) {
          console.log(formatSwitchMessage(msg));
          seen.add(msg.id);
          await store.markRead(msg.id);
        }
        await sleep(interval * 1000);
      }
    }

    const msgs = await store.inbox(me, { unreadOnly: context.rest.includes("--unread") });
    const online = await new PresenceStore(presenceDir()).online(Date.now());
    console.log(`在线实例: ${online.length ? online.join(", ") : "(无)"}`);
    if (msgs.length === 0) {
      console.log("收件箱空");
      return;
    }

    for (const msg of msgs) {
      console.log(formatSwitchMessage(msg));
    }
    if (!context.rest.includes("--peek")) {
      await Promise.all(msgs.filter((msg) => !msg.read).map((msg) => store.markRead(msg.id)));
    }
    return;
  },
});

registerCliCommand({
  name: "escalations",
  run: async () => {
    const dir = join(kunpengStateDir(), "switchboard");
    const store = new SwitchboardStore(dir);
    const online = await new PresenceStore(presenceDir()).online(Date.now());
    const msgs = await store.list();
    const esc = findEscalations({ messages: msgs, online, now: Date.now() });
    if (!esc.length) { console.log("[升级] 无待升级的紧急消息 ✓"); return; }
    console.log(`[升级] ${esc.length} 条紧急消息没人收/超时——需人类介入:`);
    for (const e of esc) {
      console.log(`  🔴 [${e.reason}] ${e.message.from}→${e.message.to}: ${e.message.body.slice(0, 70)}`);
    }
    return;
  },
});

registerCliCommand({
  name: "switchboard-mcp",
  run: async () => {
    await runMcpStdio(switchboardMcpDeps(kunpengStateDir()));
    return;
  },
});

registerCliCommand({
  name: "register-agent",
  run: async (context: CliContext) => {
    const parsed = parseRegisterAgentArgs(context.rest);
    const instance = valueAfter(context.rest, "--instance") ?? process.env.KUNPENG_INSTANCE ?? "main";
    const result = await registerAgent({
      instance,
      cwd: process.cwd(),
      task: parsed.task ?? "(未注明)",
      pid: parsed.pid,
      now: Date.now(),
      presence: new PresenceStore(presenceDir()),
      ...(parsed.beatOnly ? { beatOnly: true } : {}),
    });
    if (parsed.beatOnly) {
      console.log(`[register] ${instance} 心跳已刷新（项目 ${result.projectId ?? "(未识别)"}）`);
      return;
    }
    console.log(`[register] ${instance} 已登记到项目 ${result.projectId ?? "(未识别)"} → ${result.mdPath ?? "(无)"}`);
    return;
  },
});

registerCliCommand({
  name: "outbox",
  run: async (context: CliContext) => {
    const outboxRepoRoot = findRepoRoot(context.repoArg ?? process.env.KUNPENG_REPO ?? process.cwd());
    if (context.rest.length === 0) {
      const entries = listOutbox(outboxRepoRoot);
      if (entries.length === 0) {
        console.log("outbox 空");
        return;
      }
      for (const entry of entries) {
        console.log(`[${entry.channel}] ${entry.id} ${entry.payload.urls.length} ${entry.at}`);
      }
      return;
    }

    if (context.rest[0] === "flush" && context.rest[1] === "indexnow") {
      const indexNowKey = process.env.INDEXNOW_KEY;
      if (!indexNowKey || indexNowKey.trim() === "") {
        console.error("INDEXNOW_KEY 缺失，拒绝 flush indexnow");
        process.exit(1);
      }
      const result = await flushOutbox(outboxRepoRoot, "indexnow", async (payload: OutboxPayload) => {
        const response = await submitIndexNow(payload.urls, {
          host: requirePayloadValue(payload.host, "host"),
          key: indexNowKey,
          keyLocation: payload.keyLocation,
        });
        return response.ok;
      });
      console.log(`flushed ${result.flushed} / failed ${result.failed}`);
      return;
    }

    console.error("用法: kunpeng outbox | kunpeng outbox flush indexnow");
    process.exit(1);
  },
});
