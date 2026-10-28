import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_PM_ROLE =
  "你是一名资深产品经理，对'隐形 PRD'、虚荣指标、范围蔓延零容忍；要求需求写到具体客户与具体场景，明确 Non-Goals 与权衡。";

export async function loadRolePrompt(repoRoot: string, role: string): Promise<string> {
  try {
    const content = await readFile(join(repoRoot, "roster", `${role}.role.md`), "utf8");
    if (content.trim() !== "") return content;
  } catch {
    // Fall through to deterministic defaults; role loading must never break product flow.
  }

  if (role === "product-manager") return DEFAULT_PM_ROLE;
  return "";
}
