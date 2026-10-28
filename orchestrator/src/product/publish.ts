import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { productLoopDir } from "./loop-store.js";
import { readPreview, startPreview } from "./preview.js";

export interface PublishRecord {
  channel: "local";
  url: string;
  publishedAt: number;
}

async function freeTcpPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolvePort(port));
        return;
      }
      server.close(() => reject(new Error("无法获取空闲端口")));
    });
  });
}

async function ensurePreview(repoRoot: string, slug: string, now: number): Promise<{ url: string }> {
  const current = await readPreview(repoRoot, slug);
  if (current?.alive) return { url: current.url };
  const port = await freeTcpPort();
  return startPreview(repoRoot, slug, { port, now });
}

function publishPath(repoRoot: string, slug: string): string {
  return join(productLoopDir(repoRoot, slug), "publish.json");
}

export async function publishLocal(
  repoRoot: string,
  slug: string,
  now: number,
  deps: { ensurePreview?: (repoRoot: string, slug: string) => Promise<{ url: string }> } = {},
): Promise<PublishRecord> {
  const preview = await (deps.ensurePreview ?? ((root, productSlug) => ensurePreview(root, productSlug, now)))(repoRoot, slug);
  const record: PublishRecord = { channel: "local", url: preview.url, publishedAt: now };
  const dir = productLoopDir(repoRoot, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(publishPath(repoRoot, slug), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export async function readPublish(repoRoot: string, slug: string): Promise<PublishRecord | undefined> {
  try {
    return JSON.parse(await readFile(publishPath(repoRoot, slug), "utf8")) as PublishRecord;
  } catch {
    return undefined;
  }
}
