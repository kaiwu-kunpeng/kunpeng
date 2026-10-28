import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../util/atomic-write.js";
import { productSlug } from "./artifacts.js";
import type { InterviewSession, ProductDiscovery, ProductValidation, ShapedPitch } from "./contract.js";

function interviewPath(repoRoot: string): string {
  return join(repoRoot, ".kunpeng", "product", "interview.json");
}

function perSlugInterviewPath(repoRoot: string, slug: string): string {
  return join(repoRoot, ".kunpeng", "product", slug, "interview.json");
}

function activePath(repoRoot: string): string {
  return join(repoRoot, ".kunpeng", "product", "active.json");
}

async function readActiveSlug(repoRoot: string): Promise<string | undefined> {
  try {
    const active = JSON.parse(await readFile(activePath(repoRoot), "utf8")) as { slug?: unknown };
    return typeof active.slug === "string" && active.slug.trim() ? active.slug : undefined;
  } catch {
    return undefined;
  }
}

export async function readInterview(repoRoot: string): Promise<InterviewSession | undefined> {
  const activeSlug = await readActiveSlug(repoRoot);
  if (activeSlug) {
    const activeInterview = await readInterviewFor(repoRoot, activeSlug);
    if (activeInterview) return activeInterview;
  }
  try {
    return JSON.parse(await readFile(interviewPath(repoRoot), "utf8")) as InterviewSession;
  } catch {
    return undefined;
  }
}

export async function writeInterview(repoRoot: string, session: InterviewSession): Promise<void> {
  const slug = productSlug(session.idea);
  const path = perSlugInterviewPath(repoRoot, slug);
  await writeFileAtomic(path, JSON.stringify(session, null, 2));
  await writeFileAtomic(activePath(repoRoot), JSON.stringify({ slug }, null, 2));
}

export async function activateProduct(repoRoot: string, slug: string): Promise<boolean> {
  const session = await readInterviewFor(repoRoot, slug);
  if (!session) return false;
  const path = activePath(repoRoot);
  await writeFileAtomic(path, JSON.stringify({ slug }, null, 2));
  return true;
}

export async function readInterviewFor(repoRoot: string, slug: string): Promise<InterviewSession | undefined> {
  try {
    return JSON.parse(await readFile(perSlugInterviewPath(repoRoot, slug), "utf8")) as InterviewSession;
  } catch {
    return undefined;
  }
}

type ProductStageArtifactMap = {
  discover: ProductDiscovery;
  shape: ShapedPitch;
  validate: ProductValidation;
};

function stagePath(repoRoot: string, stage: keyof ProductStageArtifactMap): string {
  return join(repoRoot, ".kunpeng", "product", `${stage}.json`);
}

export async function readProductStageArtifact<K extends keyof ProductStageArtifactMap>(
  repoRoot: string,
  stage: K,
): Promise<ProductStageArtifactMap[K] | undefined> {
  try {
    return JSON.parse(await readFile(stagePath(repoRoot, stage), "utf8")) as ProductStageArtifactMap[K];
  } catch {
    return undefined;
  }
}

export async function writeProductStageArtifact<K extends keyof ProductStageArtifactMap>(
  repoRoot: string,
  stage: K,
  artifact: ProductStageArtifactMap[K],
): Promise<void> {
  const path = stagePath(repoRoot, stage);
  await writeFileAtomic(path, JSON.stringify(artifact, null, 2));
}

export function readProductDiscovery(repoRoot: string): Promise<ProductDiscovery | undefined> {
  return readProductStageArtifact(repoRoot, "discover");
}

export function writeProductDiscovery(repoRoot: string, artifact: ProductDiscovery): Promise<void> {
  return writeProductStageArtifact(repoRoot, "discover", artifact);
}

export function readShapedPitch(repoRoot: string): Promise<ShapedPitch | undefined> {
  return readProductStageArtifact(repoRoot, "shape");
}

export function writeShapedPitch(repoRoot: string, artifact: ShapedPitch): Promise<void> {
  return writeProductStageArtifact(repoRoot, "shape", artifact);
}

export function readProductValidation(repoRoot: string): Promise<ProductValidation | undefined> {
  return readProductStageArtifact(repoRoot, "validate");
}

export function writeProductValidation(repoRoot: string, artifact: ProductValidation): Promise<void> {
  return writeProductStageArtifact(repoRoot, "validate", artifact);
}
