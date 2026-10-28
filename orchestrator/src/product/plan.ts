import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  EstimateForecast,
  ProductDefinition,
  ProductDiscovery,
  ProductIteration,
  ProductValidation,
  ShapedPitch,
  StoryMap,
  TaskEstimate,
} from "./contract.js";
import type { ProductGate } from "./cli.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { estimateProject } from "./estimate.js";
import { buildStoryMap } from "./story-map.js";
import {
  readInterview,
  readProductDiscovery,
  readProductValidation,
  readShapedPitch,
} from "./store.js";
import { velocitiesFromFlows } from "./velocity-source.js";

export interface ProductPlan {
  definition: ProductDefinition | null;
  gate: ProductGate | null;
  storyMap: StoryMap | null;
  forecast: EstimateForecast | null;
  discovery: ProductDiscovery | null;
  pitch: ShapedPitch | null;
  validation: ProductValidation | null;
  nextIteration: ProductIteration | null;
}

async function readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function buildProductPlan(
  repoRoot: string,
  opts?: { hoursPerTask?: number; seed?: number },
): Promise<ProductPlan> {
  const definition = (await readInterview(repoRoot).catch(() => undefined))?.definition ?? null;
  const discovery = (await readProductDiscovery(repoRoot).catch(() => undefined)) ?? null;
  const pitch = (await readShapedPitch(repoRoot).catch(() => undefined)) ?? null;
  const validation = (await readProductValidation(repoRoot).catch(() => undefined)) ?? null;
  const gate = await readJsonSafe<ProductGate>(join(repoRoot, ".kunpeng", "product", "draft-spec.gate.json"));
  const nextIteration = await readJsonSafe<ProductIteration>(
    join(repoRoot, ".kunpeng", "product", "next-iteration.json"),
  );
  const storyMap = definition ? buildStoryMap(definition) : null;
  const storyTasks = storyMap?.slices.flatMap((slice) => slice.tasks) ?? [];
  const baselineHours = opts?.hoursPerTask ?? 8;
  const velocities = await (async (): Promise<number[]> => {
    const tracker = new FlowTracker(resolveProjectStateDir(repoRoot));
    return velocitiesFromFlows(await tracker.list(), baselineHours);
  })().catch(() => []);
  const forecast =
    storyMap && storyTasks.length > 0
      ? estimateProject(
          storyTasks.map((task): TaskEstimate => ({ title: task.title, estimateHours: baselineHours })),
          velocities,
          { seed: opts?.seed },
        )
      : null;

  return {
    definition,
    gate,
    storyMap,
    forecast,
    discovery,
    pitch,
    validation,
    nextIteration,
  };
}
