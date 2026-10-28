#!/usr/bin/env node
// kunpeng-stop-hook.mjs — Claude Code PreToolUse hook (ADR-0009 Flow 3)
//
// Lets `kunpeng signal --to <实例>` interrupt a *busy* interactive Claude Code
// chat. Before every tool call this hook checks the switchboard for a pending
// stop signal addressed to the current instance. If one is found it BLOCKS the
// tool call (so Claude halts and surfaces the stop note) and writes a receipt
// back to the sender (via the shared checkStopSignal, which also markRead's the
// stop) so the sender knows it landed and won't keep re-triggering.
//
// Reuses the compiled orchestrator artifacts — it does NOT re-implement the
// switchboard logic. Identity / store-dir resolution mirror the CLI exactly.
//
// Protocol: PreToolUse hooks deny a tool by printing the hookSpecificOutput
// JSON below to stdout and exiting 0. No match → exit 0 with no output (allow).
// The hook is fail-open: any internal error logs to stderr and exits 0 so a
// broken hook never wedges the user's session.

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// scripts/ -> orchestrator/ -> orchestrator/dist
const distDir = join(here, "..", "dist");

function allow() {
  // No stop pending (or fail-open): say nothing, let the tool run.
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }) + "\n",
  );
  process.exit(0);
}

// kunpengStateDir() equivalent — keep in lockstep with project/registry.ts.
function kunpengStateDir() {
  return process.env.KUNPENG_STATE ?? join(homedir(), ".kunpeng");
}

// resolveIdentity() equivalent for the hook context (no --flag here):
// env KUNPENG_INSTANCE > cwd/.kunpeng-instance > "main".
function resolveInstance(cwd) {
  const env = (process.env.KUNPENG_INSTANCE ?? "").trim();
  if (env) return env;
  try {
    const fromFile = readFileSync(join(cwd, ".kunpeng-instance"), "utf8").trim();
    if (fromFile) return fromFile;
  } catch {
    // no instance file — fall through
  }
  return "main";
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// prompt-shield：注入/外传绊线（编译产物,独立于会漂移的 repo dist）。fail-open。
async function loadShield() {
  try {
    return await import(pathToFileURL(join(homedir(), ".kunpeng", "hooks", "prompt-shield.mjs")).href);
  } catch {
    return null;
  }
}

async function main() {
  // PreToolUse payload arrives on stdin; we need cwd for identity + the Bash command for the egress tripwire.
  let cwd = process.cwd();
  let toolName = "";
  let bashCommand = "";
  try {
    const raw = await readStdin();
    if (raw.trim()) {
      const payload = JSON.parse(raw);
      if (typeof payload.cwd === "string" && payload.cwd.trim()) cwd = payload.cwd;
      if (typeof payload.tool_name === "string") toolName = payload.tool_name;
      const ti = payload.tool_input;
      if (ti && typeof ti.command === "string") bashCommand = ti.command;
    }
  } catch {
    // bad/empty stdin — keep cwd default
  }

  // Egress 绊线：Bash 命令若命中高置信度外传/RCE(读密钥外传、下载即执行、回连已知外传域名)→ 拦下。
  // 保守 fail-open：shield 缺失或判定放行则不拦。这是防御纵深——就算某注入指令钻进了某 agent 上下文,危险动作也执行不了。
  if (toolName === "Bash" && bashCommand.trim()) {
    const shield = await loadShield();
    if (shield?.classifyDangerousCommand) {
      const verdict = shield.classifyDangerousCommand(bashCommand);
      if (verdict.block) {
        deny(
          `🛡 鲲鹏安全绊线拦截：该命令命中高危外传/远程执行特征 (${verdict.reason})。\n` +
            `已阻止执行。若确为本人有意操作,请手动在终端运行；这道绊线用于防注入指令劫持 agent 外传凭据。`,
        );
        return;
      }
    }
  }

  const me = resolveInstance(cwd);

  // Import compiled artifacts (ESM, .js extensions required).
  const { SwitchboardStore } = await import(pathToFileURL(join(distDir, "switchboard", "store.js")).href);
  const { checkStopSignal } = await import(pathToFileURL(join(distDir, "switchboard", "signal.js")).href);

  const store = new SwitchboardStore(join(kunpengStateDir(), "switchboard"));
  const deps = { now: () => Date.now(), id: () => `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };

  // checkStopSignal: if any pending stop -> ack (receipt) + markRead, returns reason.
  const result = await checkStopSignal(store, me, deps);
  if (result.stopped) {
    const rawNote = result.reason || "收到停止信号";
    // switchboard 内容是不可信源：高危注入话术则隔离原文,否则包成「不可信数据·非指令」外框。
    const shield = await loadShield();
    let note = rawNote;
    if (shield?.classifyInjectionRisk && shield.classifyInjectionRisk(rawNote).risk === "high") {
      note = `⚠ 一条停止信号内容疑似注入,已隔离原文(未展开)。请用 \`kunpeng inbox\` 人工查看后再决定。`;
    } else if (shield?.wrapUntrusted) {
      note = shield.wrapUntrusted(`switchboard 停止信号 → ${me}`, rawNote);
    }
    deny(
      `鲲鹏停止信号 (kunpeng signal → ${me})：${note}\n` +
        `已自动回执发起方。请立即停止当前工作并等待用户下一步指示。`,
    );
    return;
  }

  allow();
}

main().catch((err) => {
  // Fail open: never block the user because the hook itself broke.
  process.stderr.write(`[kunpeng-stop-hook] 跳过（内部错误，已放行）：${err?.message ?? err}\n`);
  process.exit(0);
});
