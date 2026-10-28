import type { CodeEdge, CodeNode } from "./types.js";

interface SerializedCodeGraph {
  nodes: CodeNode[];
  edges: CodeEdge[];
}

export class CodeGraphStore {
  private readonly nodesById = new Map<string, CodeNode>();
  private readonly edges: CodeEdge[] = [];

  addNode(node: CodeNode): void {
    this.nodesById.set(node.id, node);
  }

  addEdge(edge: CodeEdge): void {
    this.edges.push(edge);
  }

  callers(name: string): CodeNode[] {
    const targetIds = this.idsByName(name);
    const seen = new Set<string>();
    const callers: CodeNode[] = [];

    for (const edge of this.edges) {
      if (edge.kind !== "calls" || !targetIds.has(edge.to)) {
        continue;
      }

      const source = this.nodesById.get(edge.from);
      if (source === undefined || seen.has(source.id)) {
        continue;
      }

      seen.add(source.id);
      callers.push(source);
    }

    return callers;
  }

  callees(name: string): CodeNode[] {
    const sourceIds = this.idsByName(name);
    const seen = new Set<string>();
    const callees: CodeNode[] = [];

    for (const edge of this.edges) {
      if (edge.kind !== "calls" || !sourceIds.has(edge.from)) {
        continue;
      }

      const target = this.nodesById.get(edge.to);
      if (target === undefined || seen.has(target.id)) {
        continue;
      }

      seen.add(target.id);
      callees.push(target);
    }

    return callees;
  }

  search(substr: string): CodeNode[] {
    const needle = substr.toLocaleLowerCase();
    return [...this.nodesById.values()]
      .filter((node) => node.name.toLocaleLowerCase().includes(needle))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  stats(): { nodes: number; edges: number } {
    return {
      nodes: this.nodesById.size,
      edges: this.edges.length,
    };
  }

  toJSON(): string {
    return JSON.stringify({
      nodes: [...this.nodesById.values()],
      edges: this.edges,
    });
  }

  static fromJSON(s: string): CodeGraphStore {
    const data = JSON.parse(s) as SerializedCodeGraph;
    const store = new CodeGraphStore();

    for (const node of data.nodes) {
      store.addNode(node);
    }

    for (const edge of data.edges) {
      store.addEdge(edge);
    }

    return store;
  }

  private idsByName(name: string): Set<string> {
    const ids = new Set<string>();

    for (const node of this.nodesById.values()) {
      if (node.name === name) {
        ids.add(node.id);
      }
    }

    return ids;
  }
}
