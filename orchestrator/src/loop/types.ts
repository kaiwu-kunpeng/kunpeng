import { z } from "zod";
import { ACTION_LEVELS } from "../policy/action-levels.js";

export { ACTION_LEVELS, type ActionLevel } from "../policy/action-levels.js";

export const EVIDENCE_KINDS = ["telemetry", "crawl", "llm-self-report", "repo-count"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

const LeverSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["active", "needs-dev", "honest-zero"]),
  level: z.enum(ACTION_LEVELS).optional(),
});
export type Lever = z.infer<typeof LeverSchema>;

export function parseLeverSpec(raw: string): Lever {
  const parts = raw.split("=");
  const [id, label, level] = parts;
  const parsedLevel = z.enum(ACTION_LEVELS).safeParse(level);
  if (parts.length !== 3 || !id || !label || !parsedLevel.success) {
    throw new Error(`invalid lever spec: ${raw}`);
  }
  return { id, label, status: "active", level: parsedLevel.data };
}

export const WaveSchema = z.object({
  seq: z.number(),
  at: z.number(),
  lever: z.string(),
  subject: z.string(),
  metricDelta: z.number(),
  metricAfter: z.number(),
  commit: z.string().optional(),
  deploy: z.string().optional(),
  verified: z.boolean(),
  evidenceKind: z.enum(EVIDENCE_KINDS).optional(),
  level: z.enum(ACTION_LEVELS).optional(),
  outboxId: z.string().optional(),
  instrumentBroken: z.boolean().optional(),
  detail: z.string().optional(),
  gotchas: z.array(z.string()).optional(),
});
export type Wave = z.infer<typeof WaveSchema>;

export const LoopDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  recipe: z.string(),
  autonomous: z.boolean().optional(),
  goalId: z.string().optional(),
  metric: z.object({
    key: z.string(),
    label: z.string(),
    current: z.number(),
    observational: z.boolean().optional(),
  }),
  goal: z.object({
    target: z.number(),
    direction: z.enum(["up", "down"]).optional(),
    note: z.string().optional(),
  }).optional(),
  levers: z.array(LeverSchema),
  nextLever: z.object({
    lever: z.string(),
    target: z.string().optional(),
    note: z.string().optional(),
    skills: z.array(z.string()).optional(),
  }).optional(),
  waves: z.array(WaveSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type LoopDef = z.infer<typeof LoopDefSchema>;
