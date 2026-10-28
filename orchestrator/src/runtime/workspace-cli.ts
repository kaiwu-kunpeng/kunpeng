import { Workspace } from "../git/workspace.js";
import { writeInstanceFile } from "../switchboard/identity.js";

export interface WorkspaceCliResult {
  ok: boolean;
  id: string;
  path?: string;
  branch?: string;
  error?: string;
}

export interface WorkspaceCliDeps {
  writeInstanceFile?: (dir: string, id: string) => Promise<void>;
}

const USAGE = "用法: kunpeng workspace <acquire|release|abandon> <id> [base]";

export async function runWorkspaceCommand(
  rest: string[],
  ws: Workspace,
  deps: WorkspaceCliDeps = {},
): Promise<WorkspaceCliResult> {
  const action = rest[0] ?? "";
  const id = (rest[1] ?? "").trim();

  if (!id) return { ok: false, id: "", error: USAGE };

  if (action === "acquire") {
    const flow = await ws.acquire(id, rest[2]);
    await (deps.writeInstanceFile ?? writeInstanceFile)(flow.path, id);
    return { ok: true, id, path: flow.path, branch: flow.branch };
  }

  if (action === "release") {
    await ws.release(id);
    return { ok: true, id };
  }

  if (action === "abandon") {
    await ws.rollback(id);
    return { ok: true, id };
  }

  return { ok: false, id, error: `未知 workspace 动作: ${action}` };
}
