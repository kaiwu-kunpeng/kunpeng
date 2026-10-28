import simpleGit from "simple-git";
import { errorMessage } from "../util/errors.js";

export interface Checkpoint {
  stage: string;
  sha: string;
}

export interface CkptResult {
  ok: boolean;
  sha?: string;
  error?: string;
}

function branchName(flowId: string): string {
  return `kp/${flowId}`;
}

function tagName(flowId: string, stage: string): string {
  return `kp-ckpt/${flowId}/${stage}`;
}

/** Tag kp/<flowId> branch HEAD as kp-ckpt/<flowId>/<stage>, replacing an existing tag. */
export async function snapshotCheckpoint(repoRoot: string, flowId: string, stage: string): Promise<CkptResult> {
  const git = simpleGit(repoRoot);
  const branch = branchName(flowId);
  const tag = tagName(flowId, stage);
  try {
    const sha = (await git.revparse([branch])).trim();
    await git.tag(["-f", tag, sha]);
    return { ok: true, sha };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** List checkpoints for a flow. Read failures return an empty list instead of throwing. */
export async function listCheckpoints(repoRoot: string, flowId: string): Promise<Checkpoint[]> {
  const git = simpleGit(repoRoot);
  const prefix = `kp-ckpt/${flowId}/`;
  try {
    const tags = (await git.tags()).all;
    const checkpoints: Checkpoint[] = [];
    for (const tag of tags.filter((candidate) => candidate.startsWith(prefix))) {
      try {
        checkpoints.push({
          stage: tag.slice(prefix.length),
          sha: (await git.revparse([tag])).trim(),
        });
      } catch {
        // A tag that disappears while listing should not make the read path throw.
      }
    }
    return checkpoints;
  } catch {
    return [];
  }
}

/** Move kp/<flowId> back to a checkpoint tag. Missing tags return ok:false. */
export async function restoreCheckpoint(repoRoot: string, flowId: string, stage: string): Promise<CkptResult> {
  const git = simpleGit(repoRoot);
  const branch = branchName(flowId);
  const tag = tagName(flowId, stage);
  try {
    const sha = (await git.revparse([tag])).trim();
    try {
      await git.raw(["branch", "-f", branch, tag]);
    } catch {
      await git.raw(["update-ref", `refs/heads/${branch}`, sha]);
    }
    return { ok: true, sha };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
