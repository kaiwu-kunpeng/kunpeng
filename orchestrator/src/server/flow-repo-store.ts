import { readFileSync, writeFileSync } from "node:fs";

type FlowRepoMapping = Record<string, string>;

function asFlowRepoMapping(value: unknown): FlowRepoMapping | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (!Object.values(value).every((repoRoot) => typeof repoRoot === "string")) return undefined;
  return value as FlowRepoMapping;
}

export class FlowRepoStore {
  constructor(
    private readonly path: string,
    private readonly max = 5000,
  ) {}

  get(flowId: string): string | undefined {
    const mapping = this.read();
    return mapping && Object.hasOwn(mapping, flowId) ? mapping[flowId] : undefined;
  }

  set(flowId: string, repoRoot: string): void {
    try {
      const entries = Object.entries(this.read() ?? {}).filter(([storedFlowId]) => storedFlowId !== flowId);
      entries.push([flowId, repoRoot]);
      const max = Math.max(0, Math.trunc(this.max));
      const retained = Number.isFinite(max)
        ? entries.slice(Math.max(0, entries.length - max))
        : entries;
      writeFileSync(this.path, JSON.stringify(Object.fromEntries(retained)));
    } catch {
      // Flow/repo persistence is best-effort; merge fails closed later if the mapping is unavailable.
    }
  }

  private read(): FlowRepoMapping | undefined {
    try {
      return asFlowRepoMapping(JSON.parse(readFileSync(this.path, "utf8")) as unknown);
    } catch {
      return undefined;
    }
  }
}
