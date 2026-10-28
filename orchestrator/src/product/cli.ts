import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRunner } from "../agent/runner.js";
import { extractFirstJsonObject } from "../util/extract-json.js";
import { PRODUCT_DEFINE_FAQ_ANCHORS, type InterviewSession, type ProductDefinition } from "./contract.js";
import { autoDefineProduct } from "./auto-define.js";
import { assessConcreteness, type ConcretenessIssue } from "./concreteness.js";
import { productSlug } from "./artifacts.js";
import { draftSpecForDefinition } from "./loop-orchestrate.js";
import {
  buildCritiquePrompt,
  critiqueDefinition,
  type CritiqueFinding,
  type CritiqueVerdict,
  type PmCritique,
} from "./pm-critic.js";
import { loadRolePrompt } from "./role.js";
import { createProduct } from "./registry-service.js";
import { writeInterview } from "./store.js";
import { definitionToSpec } from "./to-spec.js";

export interface ProductGate {
  blocked: boolean;
  requiresHumanReview: boolean;
  concreteness: {
    pass: boolean;
    score: number;
    issues: ConcretenessIssue[];
  };
  critique: {
    verdict: CritiqueVerdict;
    deterministic: CritiqueFinding[];
    llm: CritiqueFinding[];
    llmRan: boolean;
  };
}

export interface ProductCommandResult {
  slug: string;
  definition: ProductDefinition;
  draftSpecPath: string;
  gatePath: string;
  gate: ProductGate;
}

export async function runProductCommand(input: {
  repoRoot: string;
  idea: string;
  runner: AgentRunner;
  now?: number;
}): Promise<ProductCommandResult> {
  const now = input.now ?? Date.now();
  const idea = input.idea.trim();
  if (!idea) throw new Error("产品想法不能为空");

  const definition = await autoDefineProduct(idea, input.runner);
  const session: InterviewSession = {
    idea,
    status: "done",
    step: PRODUCT_DEFINE_FAQ_ANCHORS.length,
    answers: [],
    definition,
  };
  await writeInterview(input.repoRoot, session);

  const productDir = join(input.repoRoot, ".kunpeng", "product");
  await mkdir(productDir, { recursive: true });
  const draftSpecPath = join(productDir, "draft-spec.md");
  await writeFile(draftSpecPath, definitionToSpec(definition), "utf8");

  const concreteness = assessConcreteness(definition);
  const deterministic = critiqueDefinition(definition);
  const llm = await runLlmCritique(input.repoRoot, definition, input.runner);
  const verdicts: CritiqueVerdict[] = [deterministic.verdict, ...(llm ? [llm.verdict] : [])];
  const critiqueVerdict: CritiqueVerdict = verdicts.includes("block")
    ? "block"
    : verdicts.includes("revise")
      ? "revise"
      : "pass";
  const blocked = !concreteness.pass || critiqueVerdict === "block";
  const gate: ProductGate = {
    blocked,
    requiresHumanReview: blocked || critiqueVerdict === "revise",
    concreteness: {
      pass: concreteness.pass,
      score: concreteness.score,
      issues: concreteness.issues,
    },
    critique: {
      verdict: critiqueVerdict,
      deterministic: deterministic.findings,
      llm: llm?.findings ?? [],
      llmRan: llm !== null,
    },
  };
  const gatePath = join(productDir, "draft-spec.gate.json");
  await writeFile(gatePath, JSON.stringify(gate, null, 2), "utf8");

  await createProduct(input.repoRoot, idea, now, "scratch").catch(() => undefined);
  await draftSpecForDefinition(input.repoRoot, definition, now).catch(() => undefined);

  return { slug: productSlug(idea), definition, draftSpecPath, gatePath, gate };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeFinding(value: unknown): CritiqueFinding | null {
  const item = objectRecord(value);
  if (!item) return null;

  return {
    severity: item.severity === "block" ? "block" : "warn",
    category: typeof item.category === "string" ? item.category : "",
    issue: typeof item.issue === "string" ? item.issue : "",
    suggestion: typeof item.suggestion === "string" ? item.suggestion : "",
  };
}

async function runLlmCritique(
  repoRoot: string,
  definition: ProductDefinition,
  runner: AgentRunner,
): Promise<PmCritique | null> {
  try {
    const system = await loadRolePrompt(repoRoot, "product-manager");
    const out = await runner.run({
      stage: "review",
      system,
      input: buildCritiquePrompt(definition),
      tools: [],
    });
    if (!out.text) return null;

    const parsed = JSON.parse(extractFirstJsonObject(out.text)) as unknown;
    const obj = objectRecord(parsed);
    if (!obj) return null;

    const findings = Array.isArray(obj.findings)
      ? obj.findings.map(normalizeFinding).filter((finding): finding is CritiqueFinding => finding !== null)
      : [];
    const verdict: CritiqueVerdict =
      obj.verdict === "block" ? "block" : obj.verdict === "revise" ? "revise" : "pass";

    return {
      findings,
      verdict,
      requiresHumanGate: verdict !== "pass",
    };
  } catch {
    return null;
  }
}
