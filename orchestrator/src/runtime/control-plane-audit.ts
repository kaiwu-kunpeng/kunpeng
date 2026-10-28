import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { kunpengStateDir } from "../project/state-dir.js";

export const CONTROL_PLANE_REPO_FILES = [".kunpeng/gates.json", ".kunpeng/hooks.json", ".kunpeng/checks.json", ".kunpeng/public-surface.json"] as const;
export const STATE_GATES_KEY = "state:gates.json";

export interface ControlPlaneSnapshot { files: Record<string, string> }
export interface ControlPlaneChange { at: number; repoRoot: string; file: string; before: string; after: string }

function hashFile(path: string): string {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw error;
  }
}

export function snapshotControlPlane(repoRoot: string, stateDir: string): ControlPlaneSnapshot {
  const files: Record<string, string> = {};
  for (const file of CONTROL_PLANE_REPO_FILES) files[file] = hashFile(join(repoRoot, file));
  let opsGateNames: string[];
  try {
    opsGateNames = readdirSync(join(repoRoot, ".kunpeng", "ops-gates"), { withFileTypes: true })
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".json"))
      .map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    opsGateNames = [];
  }
  for (const name of opsGateNames) {
    const file = `.kunpeng/ops-gates/${name}`;
    files[file] = hashFile(join(repoRoot, file));
  }
  files[STATE_GATES_KEY] = hashFile(join(stateDir, "gates.json"));
  return { files };
}

export function diffControlPlane(before: ControlPlaneSnapshot | undefined, after: ControlPlaneSnapshot): Array<{ file: string; before: string; after: string }> {
  const keys = [...new Set([...Object.keys(before?.files ?? {}), ...Object.keys(after.files)])].sort();
  return keys.flatMap((file) => {
    const previous = before === undefined ? "unseen" : (before.files[file] ?? "absent");
    const current = after.files[file] ?? "absent";
    return previous === current ? [] : [{ file, before: previous, after: current }];
  });
}

export function controlPlaneAuditPath(stateDir: string): string {
  return join(stateDir, "audit", "control-plane.jsonl");
}

export function controlPlaneLastSnapshotPath(stateDir: string, repoRoot: string): string {
  return join(stateDir, "audit", "control-plane", `${repoRoot.replace(/[^A-Za-z0-9]+/g, "-")}.json`);
}

function readLastSnapshot(path: string): ControlPlaneSnapshot | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const files = (parsed as Partial<ControlPlaneSnapshot>).files;
  if (!files || typeof files !== "object" || Array.isArray(files)) return undefined;
  if (!Object.values(files).every((value) => typeof value === "string")) return undefined;
  return { files };
}

/** 只追加变更摘要；任何 I/O 失败仅告警，不阻断调用方。 */
export function recordControlPlaneChanges(
  repoRoot: string,
  opts: { stateDir?: string; now?: () => number; warn?: (message: string) => void } = {},
): ControlPlaneChange[] {
  const warn = opts.warn ?? ((message: string) => console.warn(message));
  try {
    const stateDir = opts.stateDir ?? kunpengStateDir();
    const snapshotPath = controlPlaneLastSnapshotPath(stateDir, repoRoot);
    const before = readLastSnapshot(snapshotPath);
    const after = snapshotControlPlane(repoRoot, stateDir);
    const at = (opts.now ?? Date.now)();
    const changes = diffControlPlane(before, after).map((change) => ({ at, repoRoot, ...change }));
    mkdirSync(dirname(snapshotPath), { recursive: true });
    if (changes.length > 0) {
      appendFileSync(controlPlaneAuditPath(stateDir), changes.map((change) => `${JSON.stringify(change)}\n`).join(""), "utf8");
    }
    writeFileSync(snapshotPath, JSON.stringify(after), "utf8");
    return changes;
  } catch (error) {
    warn(`[control-plane-audit] 控制面审计失败: ${String(error)}`);
    return [];
  }
}

export function readControlPlaneAudit(stateDir: string, limit = 100): ControlPlaneChange[] {
  let raw: string;
  try {
    raw = readFileSync(controlPlaneAuditPath(stateDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const count = Number.isSafeInteger(limit) && limit >= 0 ? limit : 100;
  if (count === 0) return [];
  const changes: ControlPlaneChange[] = [];
  for (const line of raw.trimEnd().split("\n").slice(-count)) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const row = parsed as Partial<ControlPlaneChange>;
    if (typeof row.at !== "number" || !Number.isFinite(row.at) || typeof row.repoRoot !== "string" ||
        typeof row.file !== "string" || typeof row.before !== "string" || typeof row.after !== "string") continue;
    changes.push({ at: row.at, repoRoot: row.repoRoot, file: row.file, before: row.before, after: row.after });
  }
  return changes;
}
