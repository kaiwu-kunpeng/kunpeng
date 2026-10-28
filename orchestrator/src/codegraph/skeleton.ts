import type { CodeGraphStore } from "./store.js";

export function skeleton(store: CodeGraphStore): string {
  return store
    .search("")
    .sort((a, b) => {
      const fileOrder = a.file.localeCompare(b.file);
      if (fileOrder !== 0) {
        return fileOrder;
      }
      return a.line - b.line;
    })
    .map((node) => `${node.kind} ${node.name} @ ${node.file}:${node.line}`)
    .join("\n");
}
