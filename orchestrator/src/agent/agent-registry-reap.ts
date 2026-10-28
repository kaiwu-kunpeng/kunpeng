import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { isProcessAlive } from "../util/liveness.js";

export interface ParsedAgentRecord {
  iso: string;
  instance: string;
  projectId: string;
  cwd: string;
  task: string;
  pid?: number;
  host?: string;
}

export function parseAgentRegistryRecord(line: string): ParsedAgentRecord | null {
  const match = line.match(
    /^- \[([^\]]+)\] (.+?) @ (.+?) ｜ (.+?) ｜ (.*?)(?: ｜ pid=(\d+) host=(.*))?\r?\n?$/,
  );
  if (!match) return null;

  const record: ParsedAgentRecord = {
    iso: match[1],
    instance: match[2],
    projectId: match[3],
    cwd: match[4],
    task: match[5],
  };
  if (match[6] !== undefined) {
    record.pid = Number(match[6]);
    record.host = match[7];
  }
  return record;
}

export interface AliveDeps {
  host: string;
  alive(pid: number): boolean;
}

export function isRecordAlive(record: ParsedAgentRecord, deps: AliveDeps): boolean {
  if (record.pid === undefined) return false;
  if (record.host !== deps.host) return true;
  return deps.alive(record.pid);
}

export interface ReapDeps extends AliveDeps {
  listFiles(): string[];
  readFile(path: string): string;
  remove(path: string): void;
}

function fileSystemReapDeps(dir: string): ReapDeps {
  return {
    host: hostname(),
    alive: isProcessAlive,
    listFiles: () => readdirSync(dir),
    readFile: (path) => readFileSync(path, "utf8"),
    remove: (path) => unlinkSync(path),
  };
}

export function reapAgentRegistry(
  dir: string,
  deps: ReapDeps = fileSystemReapDeps(dir),
): { kept: number; reaped: number } {
  let kept = 0;
  let reaped = 0;

  let files: string[];
  try {
    files = deps.listFiles();
  } catch {
    return { kept, reaped };
  }

  for (const file of files) {
    try {
      const path = join(dir, file);
      const firstLine = deps.readFile(path).split(/\r?\n/, 1)[0];
      const record = parseAgentRegistryRecord(firstLine);
      if (record === null || isRecordAlive(record, deps)) {
        kept += 1;
        continue;
      }
      deps.remove(path);
      reaped += 1;
    } catch {
      kept += 1;
    }
  }

  return { kept, reaped };
}
