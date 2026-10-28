import type { CodeGraphStore } from "./store.js";
import type { CodeNode } from "./types.js";

export function impactedNodes(
  store: CodeGraphStore,
  name: string,
  depth = 2,
): CodeNode[] {
  if (depth <= 0) {
    return [];
  }

  const roots = store.search(name).filter((node) => node.name === name);
  const rootIds = new Set(roots.map((node) => node.id));
  const seen = new Set<string>();
  const impacted: CodeNode[] = [];
  const queue = roots.map((node) => ({ node, level: 0 }));

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];

    if (current.level >= depth) {
      continue;
    }

    for (const caller of store.callers(current.node.name)) {
      if (rootIds.has(caller.id) || seen.has(caller.id)) {
        continue;
      }

      seen.add(caller.id);
      impacted.push(caller);
      queue.push({ node: caller, level: current.level + 1 });
    }
  }

  return impacted;
}
