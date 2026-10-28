import type { ArtifactStore } from "../artifacts/store.js";
import type { Artifact } from "../artifacts/types.js";
import { writeFile } from "node:fs/promises";

export async function compileDocs(store: ArtifactStore, outFile: string): Promise<string> {
  const arts = await store.list();
  const byKind = new Map<string, Artifact[]>();
  for (const a of arts) {
    const list = byKind.get(a.kind) ?? [];
    list.push(a);
    byKind.set(a.kind, list);
  }
  const lines: string[] = ["# 鲲鹏 · 文档索引（自动生成，勿手改）", ""];
  for (const kind of [...byKind.keys()].sort()) {
    const items = byKind.get(kind)!.sort((x, y) => x.id.localeCompare(y.id));
    lines.push(`## ${kind} (${items.length})`, "");
    for (const a of items) {
      const first = (a.body.split("\n").find((l) => l.trim()) ?? "").slice(0, 80);
      lines.push(`- **${a.id}** \`[${a.status}]\` — ${first}`);
    }
    lines.push("");
  }
  const out = lines.join("\n");
  await writeFile(outFile, out, "utf8");
  return out;
}
