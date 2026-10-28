export interface CodeNode {
  id: string;
  kind: "function" | "class" | "file" | "symbol";
  name: string;
  file: string;
  line: number;
}

export interface CodeEdge {
  from: string;
  to: string;
  kind: "calls" | "imports" | "references";
}
