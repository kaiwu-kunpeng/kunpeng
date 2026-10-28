export type LocalFsOpKind = "read" | "write" | "list" | "stat" | "delete" | "mkdir";

export interface LocalFsOp {
  opId: string;
  conv: string;
  kind: LocalFsOpKind;
  path: string;
  content?: string;
  recursive?: boolean;
}

export interface LocalFsResult {
  opId: string;
  ok: boolean;
  data?: string;
  error?: string;
  encoding?: "text" | "base64";
  truncated?: boolean;
}
