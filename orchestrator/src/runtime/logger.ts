// 零依赖结构化日志（#10）。机器可查的 JSON 行 + 人读 pretty；correlation id（flowId/planId）随 child 串联。
// 默认写 stderr（不污染 stdout 的人读 UX）。KUNPENG_LOG=json 出 JSON、=debug 出 debug+，未设则只出 warn/error（安静）。
export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** 派生子 logger，合并 context（如 .child({ flowId }) 让该流所有日志自带 flowId）。 */
  child(context: Record<string, unknown>): Logger;
}

export interface LoggerOpts {
  context?: Record<string, unknown>;
  minLevel?: LogLevel;
  json?: boolean;
  sink?: (line: string) => void;   // 注入便于测试
  now?: () => number;
}

export function createLogger(opts: LoggerOpts = {}): Logger {
  const env = process.env.KUNPENG_LOG;
  const context = opts.context ?? {};
  const json = opts.json ?? (env === "json");
  const minLevel = opts.minLevel ?? (env === "debug" ? "debug" : env === "json" ? "info" : "warn");
  const sink = opts.sink ?? ((line: string) => process.stderr.write(line + "\n"));
  const now = opts.now ?? Date.now;

  function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (ORDER[level] < ORDER[minLevel]) return;
    const merged = { ...context, ...fields };
    if (json) {
      sink(JSON.stringify({ ts: now(), level, msg, ...merged }));
    } else {
      const ctx = Object.entries(merged).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
      sink(`[${level}] ${msg}${ctx ? " · " + ctx : ""}`);
    }
  }

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (c) => createLogger({ ...opts, context: { ...context, ...c } }),
  };
}
