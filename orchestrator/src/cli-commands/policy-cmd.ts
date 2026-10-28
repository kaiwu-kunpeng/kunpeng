import { resolve } from "node:path";
import { loadActionPolicy, renderActionPolicy } from "../policy/policy-files.js";
import { registerCliCommand, type CliContext } from "./registry.js";
import { valueAfter } from "./shared.js";

const USAGE = "用法: kunpeng policy show [--repo <path>] [--json]  —— 看本仓生效的动作策略（操作类别 × deny/ask/allow、来源、被底线压回的项）";

registerCliCommand({
  name: "policy",
  usage: USAGE,
  run: async (context: CliContext) => {
    if (context.rest[0] !== "show") {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }
    const repoRoot = resolve(valueAfter(context.rest, "--repo") ?? context.repoRoot);
    const policy = loadActionPolicy(repoRoot);
    console.log(context.rest.includes("--json") ? JSON.stringify(policy, null, 2) : renderActionPolicy(policy));
  },
});
