import { join } from "node:path";

import { type McpDeps } from "./mcp-server.js";
import { PresenceStore } from "./presence.js";
import { TaskStore } from "./task-store.js";

export function switchboardMcpDeps(stateDir: string): McpDeps {
  return {
    taskStore: new TaskStore(join(stateDir, "switchboard")),
    presence: new PresenceStore(join(stateDir, "presence")),
  };
}
