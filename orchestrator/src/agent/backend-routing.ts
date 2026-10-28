import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Stage } from "./runner.js";

export type Backend = "claude" | "codex";

export type BackendProbe = (bin: string) => Promise<boolean>;

export type ResolveBackendContext = {
  forced?: Backend;
  routing?: Partial<Record<Stage, Backend>>;
  available: Set<Backend>;
  down?: Set<Backend>;
  avoid?: Backend;
  env?: NodeJS.ProcessEnv;
};

export type ResolvedBackend = {
  backend: Backend;
  fellBack: boolean;
};

export type VerifyBackendPick = {
  backend: Backend;
  source: "env" | "other" | "same";
};

export const SAME_BACKEND_NOTICE = "[verify] 仅一个后端可用，评估器与实现者同后端";

const execFileAsync = promisify(execFile);
const BACKEND_FALLBACK_ORDER: Backend[] = ["claude", "codex"];

export const STAGE_BACKEND: Record<Stage, Backend> = {
  spec: "claude",
  design: "claude",
  implement: "codex",
  review: "claude",
  verify: "claude",
  audit: "claude",
};

export function backendForStage(stage: Stage, forced?: Backend): Backend {
  if (forced !== undefined) {
    return forced;
  }
  return STAGE_BACKEND[stage];
}

async function defaultProbe(bin: string): Promise<boolean> {
  try {
    await execFileAsync("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

export async function detectBackends(probe: BackendProbe = defaultProbe): Promise<Set<Backend>> {
  const available = new Set<Backend>();
  const checks = await Promise.all(
    BACKEND_FALLBACK_ORDER.map(async (backend) => ({
      backend,
      ok: await probe(backend),
    })),
  );

  for (const check of checks) {
    if (check.ok) {
      available.add(check.backend);
    }
  }

  return available;
}

export function pickVerifyBackend(
  implementBackend: Backend | undefined,
  available: Set<Backend>,
  opts: { env?: NodeJS.ProcessEnv; forced?: Backend } = {},
): VerifyBackendPick | null {
  const envBackend = (opts.env ?? process.env).KUNPENG_VERIFY_BACKEND;
  if ((envBackend === "claude" || envBackend === "codex") && available.has(envBackend)) {
    return { backend: envBackend, source: "env" };
  }
  if (opts.forced !== undefined && available.has(opts.forced)) {
    return { backend: opts.forced, source: opts.forced === implementBackend ? "same" : "other" };
  }
  const other = BACKEND_FALLBACK_ORDER.find((backend) => backend !== implementBackend && available.has(backend));
  if (other !== undefined) {
    return { backend: other, source: "other" };
  }
  if (implementBackend !== undefined && available.has(implementBackend)) {
    return { backend: implementBackend, source: "same" };
  }
  const fallback = BACKEND_FALLBACK_ORDER.find((backend) => available.has(backend));
  return fallback === undefined ? null : { backend: fallback, source: "other" };
}

export function resolveBackend(stage: Stage, ctx: ResolveBackendContext): ResolvedBackend | null {
  const down = ctx.down ?? new Set<Backend>();
  const candidates = new Set([...ctx.available].filter((backend) => !down.has(backend)));
  const verifyPick = ctx.avoid !== undefined ? pickVerifyBackend(ctx.avoid, candidates, { env: ctx.env, forced: ctx.forced }) : null;
  const preferred = verifyPick?.backend ?? ctx.forced ?? ctx.routing?.[stage] ?? STAGE_BACKEND[stage];

  if (candidates.has(preferred)) {
    return { backend: preferred, fellBack: false };
  }

  const fallback = BACKEND_FALLBACK_ORDER.find((backend) => candidates.has(backend));
  if (fallback === undefined) {
    return null;
  }

  return { backend: fallback, fellBack: true };
}
