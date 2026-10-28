export interface PtySpawnOpts {
  id: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface PtyHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (code: number) => void): void;
  pause?(): void;
  resume?(): void;
  detach?(): void;
  kill(): void;
}

export interface PtySessionInfo {
  id: string;
  workspaceId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  alive: boolean;
  createdAt: number;
  updatedAt: number;
  exitCode?: number;
}

export interface PtyCreateOpts {
  id?: string;
  workspaceId: string;
  cwd: string;
  shell?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export type PtyRemoveReason = "detached" | "killed" | "exited";

export interface PtySessionPoolOpts {
  factory: (opts: PtySpawnOpts) => PtyHandle;
  defaultShell?: string;
  scrollbackLimit?: number;
  maxSessions?: number;
  maxSessionsPerWorkspace?: number;
  idleReapMs?: number;
  deadGraceMs?: number;
  now?: () => number;
  onCreated?: (info: PtySessionInfo) => void;
  onRemoved?: (id: string, reason: PtyRemoveReason) => void;
}

interface PtySession {
  info: PtySessionInfo;
  handle: PtyHandle;
  scrollback: string;
  subscribers: Set<(data: string) => void>;
  exitSubscribers: Set<(code: number) => void>;
  disconnectedAt?: number;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_SCROLLBACK_LIMIT = 64 * 1024;
const DEFAULT_MAX_SESSIONS = 20;
const DEFAULT_MAX_SESSIONS_PER_WORKSPACE = 8;
const DEFAULT_IDLE_REAP_MS = 30 * 60_000;
const DEFAULT_DEAD_GRACE_MS = 60_000;

export class PtySessionPool {
  private readonly sessions = new Map<string, PtySession>();
  private readonly factory: (opts: PtySpawnOpts) => PtyHandle;
  private readonly defaultShell: string;
  private readonly scrollbackLimit: number;
  private readonly maxSessions: number;
  private readonly maxSessionsPerWorkspace: number;
  private readonly idleReapMs: number;
  private readonly deadGraceMs: number;
  private readonly now: () => number;
  private readonly onCreated?: (info: PtySessionInfo) => void;
  private readonly onRemoved?: (id: string, reason: PtyRemoveReason) => void;
  private nextId = 1;

  constructor(opts: PtySessionPoolOpts) {
    this.factory = opts.factory;
    this.defaultShell = opts.defaultShell ?? process.env.SHELL ?? "/bin/sh";
    this.scrollbackLimit = Math.max(0, opts.scrollbackLimit ?? DEFAULT_SCROLLBACK_LIMIT);
    this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxSessionsPerWorkspace = opts.maxSessionsPerWorkspace ?? DEFAULT_MAX_SESSIONS_PER_WORKSPACE;
    this.idleReapMs = opts.idleReapMs ?? DEFAULT_IDLE_REAP_MS;
    this.deadGraceMs = opts.deadGraceMs ?? DEFAULT_DEAD_GRACE_MS;
    this.now = opts.now ?? (() => Date.now());
    this.onCreated = opts.onCreated;
    this.onRemoved = opts.onRemoved;
  }

  create(opts: PtyCreateOpts): PtySessionInfo {
    const createdAt = this.now();
    const shell = opts.shell ?? this.defaultShell;
    const cols = opts.cols ?? DEFAULT_COLS;
    const rows = opts.rows ?? DEFAULT_ROWS;
    const id = opts.id ?? `pty-${createdAt}-${this.nextId}`;
    if (this.sessions.has(id)) {
      throw new Error(`pty session already exists: ${id}`);
    }
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`pty session pool is full: max ${this.maxSessions}`);
    }
    const workspaceSessionCount = Array.from(this.sessions.values())
      .filter((session) => session.info.workspaceId === opts.workspaceId)
      .length;
    if (workspaceSessionCount >= this.maxSessionsPerWorkspace) {
      throw new Error(`pty 工作区会话已达上限: 工作区 ${opts.workspaceId}, 上限 ${this.maxSessionsPerWorkspace}`);
    }
    if (opts.id === undefined) this.nextId++;
    const handle = this.factory({
      id,
      shell,
      cwd: opts.cwd,
      cols,
      rows,
      env: opts.env,
    });
    const session: PtySession = {
      info: {
        id,
        workspaceId: opts.workspaceId,
        cwd: opts.cwd,
        shell,
        cols,
        rows,
        alive: true,
        createdAt,
        updatedAt: createdAt,
      },
      handle,
      scrollback: "",
      subscribers: new Set(),
      exitSubscribers: new Set(),
      disconnectedAt: createdAt,
    };

    handle.onData((data) => this.handleData(session, data));
    handle.onExit((code) => {
      session.info.alive = false;
      session.info.exitCode = code;
      session.info.updatedAt = this.now();
      for (const cb of session.exitSubscribers) cb(code);
    });

    this.sessions.set(id, session);
    const info = copyInfo(session.info);
    this.emitCreated(info);
    return info;
  }

  get(id: string): PtySessionInfo | undefined {
    const session = this.sessions.get(id);
    return session ? copyInfo(session.info) : undefined;
  }

  list(workspaceId?: string): PtySessionInfo[] {
    return Array.from(this.sessions.values())
      .filter((session) => workspaceId === undefined || session.info.workspaceId === workspaceId)
      .map((session) => copyInfo(session.info));
  }

  scrollback(id: string): string {
    return this.mustGet(id).scrollback;
  }

  subscribe(id: string, cb: (data: string) => void): () => void {
    const session = this.mustGet(id);
    if (session.scrollback.length > 0) cb(session.scrollback);
    session.subscribers.add(cb);
    session.disconnectedAt = undefined;
    return () => {
      if (session.subscribers.delete(cb) && session.subscribers.size === 0) {
        session.disconnectedAt = this.now();
      }
    };
  }

  onExit(id: string, cb: (code: number) => void): () => void {
    const session = this.mustGet(id);
    if (!session.info.alive) {
      cb(session.info.exitCode ?? 0);
      return () => {};
    }
    session.exitSubscribers.add(cb);
    return () => {
      session.exitSubscribers.delete(cb);
    };
  }

  write(id: string, data: string): void {
    const session = this.mustGet(id);
    session.handle.write(data);
    session.info.updatedAt = this.now();
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.mustGet(id);
    session.handle.resize(cols, rows);
    session.info.cols = cols;
    session.info.rows = rows;
    session.info.updatedAt = this.now();
  }

  pause(id: string): void {
    const session = this.mustGet(id);
    session.handle.pause?.();
  }

  resume(id: string): void {
    const session = this.mustGet(id);
    session.handle.resume?.();
  }

  kill(id: string): void {
    const session = this.mustGet(id);
    session.handle.kill();
    session.info.alive = false;
    session.info.updatedAt = this.now();
  }

  reap(): string[] {
    const now = this.now();
    const reaped: string[] = [];
    for (const [id, session] of this.sessions) {
      const idle = now - session.info.updatedAt;
      const disconnectedIdle = session.disconnectedAt === undefined ? undefined : now - session.disconnectedAt;
      if (
        session.info.alive
        && session.subscribers.size === 0
        && disconnectedIdle !== undefined
        && disconnectedIdle > this.idleReapMs
      ) {
        const reason: PtyRemoveReason = session.handle.detach ? "detached" : "killed";
        try {
          if (session.handle.detach) session.handle.detach();
          else session.handle.kill();
        } catch {
          // Reaping is best-effort for the underlying process; the pool slot is still reclaimed.
        }
        this.sessions.delete(id);
        this.emitRemoved(id, reason);
        reaped.push(id);
      } else if (!session.info.alive && idle > this.deadGraceMs) {
        this.sessions.delete(id);
        this.emitRemoved(id, "exited");
        reaped.push(id);
      }
    }
    return reaped;
  }

  private handleData(session: PtySession, data: string): void {
    session.scrollback = trimScrollback(session.scrollback + data, this.scrollbackLimit);
    session.info.updatedAt = this.now();
    for (const cb of session.subscribers) cb(data);
  }

  private mustGet(id: string): PtySession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`no pty session: ${id}`);
    return session;
  }

  private emitCreated(info: PtySessionInfo): void {
    try {
      this.onCreated?.(copyInfo(info));
    } catch {
      // Lifecycle hooks are best-effort and must not affect pool state.
    }
  }

  private emitRemoved(id: string, reason: PtyRemoveReason): void {
    try {
      this.onRemoved?.(id, reason);
    } catch {
      // Lifecycle hooks are best-effort and must not affect pool state.
    }
  }
}

function trimScrollback(value: string, limit: number): string {
  if (value.length <= limit) return value;
  let start = value.length - limit;
  const code = value.charCodeAt(start);
  if (code >= 0xDC00 && code <= 0xDFFF) start += 1;
  const nl = value.indexOf("\n", start);
  if (nl !== -1 && nl - start < 4096) start = nl + 1;
  return value.slice(start);
}

function copyInfo(info: PtySessionInfo): PtySessionInfo {
  return { ...info };
}
