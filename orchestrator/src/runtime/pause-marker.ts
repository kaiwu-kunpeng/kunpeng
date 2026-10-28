import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function pauseMarkerPath(repoRoot: string, flowId: string): string {
  return join(repoRoot, ".kunpeng", "pause", flowId);
}

export async function requestPause(repoRoot: string, flowId: string): Promise<void> {
  const markerPath = pauseMarkerPath(repoRoot, flowId);
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, new Date().toISOString());
}

export async function isPauseRequested(repoRoot: string, flowId: string): Promise<boolean> {
  try {
    await access(pauseMarkerPath(repoRoot, flowId));
    return true;
  } catch {
    return false;
  }
}

export async function clearPause(repoRoot: string, flowId: string): Promise<void> {
  await rm(pauseMarkerPath(repoRoot, flowId), { force: true });
}
