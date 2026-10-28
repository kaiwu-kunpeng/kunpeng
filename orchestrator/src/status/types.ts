export type Light = "green" | "yellow" | "red" | "idle";
export type Category = "research-loop" | "comms" | "governance" | "ops" | "platform";

export interface ModuleStatus {
  id: string;
  name: string;
  category: Category;
  light: Light;
  wired: boolean;
  lastActivity?: { at: number; agoText: string; summary: string; ok?: boolean };
  heartbeat?: { online: boolean; detail: string };
  note?: string;
}

export interface ModuleStatusReport {
  modules: ModuleStatus[];
  rollup: { green: number; yellow: number; red: number; idle: number };
  generatedAt: number;
}

export interface StatusContext {
  now: number;
  wired: Record<string, boolean>;
  artifactCounts: Record<string, number>;
  artifactLatest: Record<string, number>;
  flows: { status: string; stage: string; updatedAt: number; blocker?: string }[];
  health: { alerts: unknown[]; running: number; healthy: number };
  evolution?: { pendingCount: number; approvedCount: number; lastRunText: string };
  loops?: { id: string; name: string; waveCount: number }[];
  patrol?: { pendingCount: number; lastRunText: string };
  quota?: { total: number; accounts: { id: string }[] };
  branches: string[];
  switchboard?: { unread: number; lastAt?: number; lastFrom?: string };
  mtimes?: Record<string, number>;
  online?: Record<string, boolean>;
  /** 手机通知通道活性：配置在不在、最近一轮扫描结果、最近成功推送、每日心跳。 */
  notify?: {
    configured: boolean;
    scan?: { at: number; candidates: number; sent: string[]; failed: string[]; skipped?: string };
    lastSentAt?: number;
    heartbeat?: { at: number; sent: string[]; failed: string[] };
  };
}

export interface ModuleDef {
  id: string;
  name: string;
  category: Category;
  derive: (ctx: StatusContext) => ModuleStatus;
}
