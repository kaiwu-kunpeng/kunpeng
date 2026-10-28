import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface BundleInput {
  kunpengRoot: string;
  outDir: string;
}

export interface BundleResult {
  outDir: string;
  files: string[];
}

function compareName(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function copyFileText(src: string, dest: string): Promise<void> {
  const content = await readFile(src, "utf8");
  await writeFile(dest, content, "utf8");
}

function buildManifest(files: string[]): string {
  return [
    "# Methodology Bundle",
    "",
    "This directory is a portable Kunpeng methodology asset bundle for agent platforms such as Claude Code, Codex, and Cursor.",
    "It contains the core constitution, conventions, and reusable skills as plain Markdown files.",
    "The bundle is generated with deterministic local file IO and does not require the Kunpeng runtime or CLI.",
    "",
    "## Files",
    "",
    ...files.map((file) => `- ${file}`),
    "",
  ].join("\n");
}

export async function buildMethodologyBundle(input: BundleInput): Promise<BundleResult> {
  await mkdir(input.outDir, { recursive: true });

  const files: string[] = [];
  const writeCopy = async (src: string, fileName: string): Promise<void> => {
    await copyFileText(src, join(input.outDir, fileName));
    files.push(fileName);
  };

  await writeCopy(
    join(input.kunpengRoot, "constitution", "core.md"),
    "constitution-core.md",
  );
  await writeCopy(
    join(input.kunpengRoot, "constitution", "conventions.md"),
    "constitution-conventions.md",
  );

  const skillsDir = join(input.kunpengRoot, "skills");
  const skillEntries = (await readdir(skillsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => compareName(a.name, b.name));

  for (const entry of skillEntries) {
    const skillFileName = `skill-${entry.name}.md`;
    const skillPath = join(skillsDir, entry.name, "SKILL.md");
    let skillContent: string;
    try {
      skillContent = await readFile(skillPath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) continue;
      throw error;
    }
    await writeFile(join(input.outDir, skillFileName), skillContent, "utf8");
    files.push(skillFileName);
  }

  files.push("MANIFEST.md");
  await writeFile(join(input.outDir, "MANIFEST.md"), buildManifest(files), "utf8");

  return { outDir: input.outDir, files };
}
