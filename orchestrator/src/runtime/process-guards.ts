export interface ProcessGuardLogEntry {
  event: "unhandledRejection" | "uncaughtException";
  reason: string;
}

export type ProcessGuardLog = (entry: ProcessGuardLogEntry) => void;
export type ProcessGuardExit = (code: number) => unknown;

export interface ProcessGuardDeps {
  on?: (
    event: "unhandledRejection" | "uncaughtException",
    handler: (value: unknown) => void,
  ) => unknown;
  log?: ProcessGuardLog;
  exit?: ProcessGuardExit;
}

let installed = false;

function reasonString(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
}

export function handleUnhandledRejection(reason: unknown, log: ProcessGuardLog): void {
  log({ event: "unhandledRejection", reason: reasonString(reason) });
}

export function handleUncaughtException(
  err: unknown,
  log: ProcessGuardLog,
  exit: ProcessGuardExit,
): void {
  try {
    log({ event: "uncaughtException", reason: reasonString(err) });
  } finally {
    exit(1);
  }
}

export function installProcessGuards(deps: ProcessGuardDeps = {}): void {
  if (installed) return;

  const on = deps.on ?? ((event, handler) => { process.on(event, handler); });
  const log = deps.log ?? ((entry) => { console.error(entry); });
  const exit = deps.exit ?? ((code) => process.exit(code));

  on("unhandledRejection", (reason) => handleUnhandledRejection(reason, log));
  on("uncaughtException", (err) => handleUncaughtException(err, log, exit));
  installed = true;
}
