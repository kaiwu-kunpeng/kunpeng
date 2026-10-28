import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ArtifactStore } from "../artifacts/store.js";
import { slugify } from "../project/registry.js";
import { buildSkillDoc } from "./skill-doc.js";

export interface DistillSkillInput {
  store: ArtifactStore;
  outDir: string;
  name: string;
  description: string;
}

export interface DistillSkillResult {
  path: string;
  experienceCount: number;
  experienceIds: string[];
}

export async function distillSkillToFile(input: DistillSkillInput): Promise<DistillSkillResult> {
  const experiences = await input.store.list("experience");
  if (experiences.length === 0) {
    throw new Error("无经验可蒸馏（experience 为空）");
  }

  const path = join(input.outDir, slugify(input.name), "SKILL.md");
  const content = buildSkillDoc(experiences, {
    name: input.name,
    description: input.description,
  });

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");

  return { path, experienceCount: experiences.length, experienceIds: experiences.map((e) => e.id) };
}
