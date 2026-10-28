import { proposeConnectorAction } from "../security/connector-gate.js";
import type { ArtifactStore } from "../artifacts/store.js";
import type { ActionSpec } from "./types.js";

export interface GateActionsResult {
  gated: number;
  total: number;
}

export async function gateDiscoveredActions(
  store: ArtifactStore,
  specs: ActionSpec[],
  opts: { sensitiveAccess: boolean },
): Promise<GateActionsResult> {
  let gated = 0;

  for (const spec of specs) {
    const r = await proposeConnectorAction(store, {
      id: `connector-web2mcp-${spec.id}`,
      name: `web2mcp ${spec.kind}：${spec.title}（${spec.target.method} ${spec.target.url}）`,
      ctx: {
        untrustedInput: true,
        externalEgress: true,
        sensitiveAccess: opts.sensitiveAccess,
      },
    });
    if (r.gated) gated += 1;
  }

  return { gated, total: specs.length };
}
