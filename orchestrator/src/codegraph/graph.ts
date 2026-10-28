import { CodeGraphStore } from "./store.js";
import type { CodeNode } from "./types.js";

export class CodeGraph {
  constructor(private readonly store: CodeGraphStore) {}

  buildContext(query: string, maxNodes = 10): string {
    const nodes = this.store.search(query).slice(0, maxNodes);

    if (nodes.length === 0) {
      return "(no match)";
    }

    return nodes.map((node) => this.renderNode(node)).join("\n\n");
  }

  private renderNode(node: CodeNode): string {
    const callers = this.store.callers(node.name).map((caller) => caller.name);
    const callees = this.store.callees(node.name).map((callee) => callee.name);

    return [
      `${node.name} (${node.kind}) @ ${node.file}:${node.line}`,
      `callers: ${this.renderNames(callers)}`,
      `callees: ${this.renderNames(callees)}`,
    ].join("\n");
  }

  private renderNames(names: string[]): string {
    return names.length === 0 ? "(none)" : names.join(", ");
  }
}
