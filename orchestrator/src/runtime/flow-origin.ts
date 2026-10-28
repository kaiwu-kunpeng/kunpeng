import { hasAgentSignal } from "./cli-actor.js";

export interface FlowOrigin {
  by: "human" | "agent" | "machine" | "unknown";
  via: string;
}

export function resolveFlowOrigin(env: Record<string, string | undefined>): FlowOrigin {
  if (hasAgentSignal(env)) {
    return { by: "agent", via: env.CLAUDECODE === "1" ? "claude-code" : "codex" };
  }
  const service = env.XPC_SERVICE_NAME;
  if (service === "com.kunpeng.serve") {
    return { by: "unknown", via: service };
  }
  if (service?.startsWith("com.kunpeng.")) {
    return { by: "machine", via: service };
  }
  return { by: "human", via: "cli" };
}
