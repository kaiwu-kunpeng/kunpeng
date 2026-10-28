import { basename, join } from "node:path";

export type KunpengObjectKind =
  | "flow"
  | "spec"
  | "artifact"
  | "agent"
  | "task"
  | "loop"
  | "capture"
  | "regression"
  | "lock"
  | "worktree";

export interface ObjectLocation {
  dir: string;
  ext: string;
}

export const OBJECT_LOCATIONS: Readonly<Record<KunpengObjectKind, ObjectLocation>> = {
  flow: { dir: "state", ext: ".json" },
  spec: { dir: "specs", ext: ".md" },
  artifact: { dir: "artifacts", ext: ".md" },
  agent: { dir: "agents-active", ext: ".md" },
  task: { dir: "tasks", ext: ".json" },
  loop: { dir: "loops", ext: ".json" },
  capture: { dir: "captures", ext: ".json" },
  regression: { dir: "regression", ext: ".json" },
  lock: { dir: "locks", ext: "" },
  worktree: { dir: "wt", ext: "" },
};

export function objectDir(repoRoot: string, kind: KunpengObjectKind): string {
  return join(repoRoot, ".kunpeng", OBJECT_LOCATIONS[kind].dir);
}

export function objectPath(repoRoot: string, kind: KunpengObjectKind, id: string): string {
  return join(objectDir(repoRoot, kind), `${id}${OBJECT_LOCATIONS[kind].ext}`);
}

export function objectIdFromPath(kind: KunpengObjectKind, filePath: string): string | null {
  const fileName = basename(filePath);
  const { ext } = OBJECT_LOCATIONS[kind];

  if (ext === "") {
    return fileName;
  }

  return fileName.endsWith(ext) ? fileName.slice(0, -ext.length) : null;
}
