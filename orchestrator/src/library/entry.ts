import { createHash } from "node:crypto";

export type LibraryEntryType = "spec" | "doc" | "capture" | "skill";
export type LibraryEntryStatus = "draft" | "active" | "archived";

export interface LibraryEntry {
  id: string;
  type: LibraryEntryType;
  title: string;
  project?: string;
  status: LibraryEntryStatus;
  tags: string[];
  audience?: "human" | "agent";
  trigger?: string;
  verifyUntil?: number;
  needsReview?: boolean;
  sourcePath: string;
  updatedAt: number;
}

export function libraryEntryId(type: LibraryEntryType, sourcePath: string): string {
  const digest = createHash("sha256").update(`${type}:${sourcePath}`).digest("hex").slice(0, 16);
  return `${type}:${digest}`;
}
