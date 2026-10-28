import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

let seq = 0;

export async function writeFileAtomic(path: string, data: string, opts?: { mode?: number }): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  seq += 1;
  const tmp = `${path}.${process.pid}.${seq}.tmp`;
  try {
    if (opts?.mode === undefined) {
      await writeFile(tmp, data, "utf8");
    } else {
      await writeFile(tmp, data, { encoding: "utf8", mode: opts.mode });
    }
    await rename(tmp, path);
    if (opts?.mode !== undefined) await chmod(path, opts.mode);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}
