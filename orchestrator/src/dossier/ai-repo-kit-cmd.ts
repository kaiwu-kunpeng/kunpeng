import { dirname, join } from "node:path";
import { buildAiRepoKit, type AiRepoKitInput } from "./ai-repo-kit.js";

export interface AiRepoKitWriter {
  mkdir(dir: string, opts: { recursive: true }): Promise<unknown>;
  writeFile(path: string, data: string): Promise<unknown>;
}

export async function runAiRepoKit(input: AiRepoKitInput, outDir: string, io: AiRepoKitWriter): Promise<number> {
  const files = buildAiRepoKit(input);

  for (const file of files) {
    const outPath = join(outDir, file.path);
    await io.mkdir(dirname(outPath), { recursive: true });
    await io.writeFile(outPath, file.content);
    console.log(file.path);
  }

  return 0;
}
