import { sendStop } from "../switchboard/signal.js";
import type { SwitchDeps, SwitchboardStore } from "../switchboard/store.js";

export type SignalCliResult =
  | { ok: true; id: string; to: string }
  | { ok: false; error: string };

const USAGE = "signal 需要 --to <实例>";
const DEFAULT_BODY = "停止请求";
const BODY_VALUE_FLAGS = new Set(["--to", "--from", "--as"]);

function valueAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index < 0) return "";
  return (args[index + 1] ?? "").trim();
}

function bodyFrom(args: string[]): string {
  const parts: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (BODY_VALUE_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) parts.push(arg);
  }

  const body = parts.join(" ").trim();
  return body === "" ? DEFAULT_BODY : body;
}

export async function runSignalCommand(
  args: string[],
  store: SwitchboardStore,
  from: string,
  deps: SwitchDeps,
): Promise<SignalCliResult> {
  const to = valueAfter(args, "--to");
  if (to === "" || to.startsWith("--")) return { ok: false, error: USAGE };

  const msg = await sendStop(store, from, to, bodyFrom(args), deps);
  return { ok: true, id: msg.id, to };
}
