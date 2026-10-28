// 产品轨阶段状态机。纯函数、不可变、无 IO。P1 三段，enum 可扩展（P2 加 build，P3 加 validate）。
export type ProductStage = "define" | "spec" | "design" | "build" | "validate";
export type StageStatus = "pending" | "drafted" | "accepted";

export const PRODUCT_STAGES: readonly ProductStage[] = ["define", "spec", "design", "build", "validate"];

export function isProductStage(value: unknown): value is ProductStage {
  return typeof value === "string" && PRODUCT_STAGES.includes(value as ProductStage);
}

export interface StageState {
  status: StageStatus;
  artifactPath: string;
  updatedAt: number;
}

export interface ProductLoopState {
  slug: string;
  idea: string;
  currentStage: ProductStage;
  stages: Record<ProductStage, StageState>;
  buildTasks?: { ids: string[]; createdAt: number };
}

export function canAcceptStage(
  state: ProductLoopState,
  stage: unknown,
): { ok: boolean; reason?: string } {
  if (!isProductStage(stage)) return { ok: false, reason: "非法产品阶段" };
  const stageState = state.stages[stage];
  if (!stageState || stageState.status !== "drafted") return { ok: false, reason: "阶段未起草" };
  return { ok: true };
}

export function nextStage(stage: ProductStage): ProductStage | undefined {
  const i = PRODUCT_STAGES.indexOf(stage);
  return i < 0 ? undefined : PRODUCT_STAGES[i + 1];
}

export function initState(slug: string, idea: string, now: number): ProductLoopState {
  const pending = (): StageState => ({ status: "pending", artifactPath: "", updatedAt: now });
  return {
    slug,
    idea,
    currentStage: "define",
    stages: {
      define: { status: "drafted", artifactPath: "", updatedAt: now },
      spec: pending(),
      design: pending(),
      build: pending(),
      validate: pending(),
    },
  };
}

export function draftStage(
  state: ProductLoopState,
  stage: ProductStage,
  artifactPath: string,
  now: number,
): ProductLoopState {
  return {
    ...state,
    currentStage: stage,
    stages: { ...state.stages, [stage]: { status: "drafted", artifactPath, updatedAt: now } },
  };
}

export function acceptStage(
  state: ProductLoopState,
  stage: ProductStage,
  now: number,
): ProductLoopState {
  const accepted: StageState = { ...state.stages[stage], status: "accepted", updatedAt: now };
  const advanceTo = nextStage(stage) ?? state.currentStage;
  return {
    ...state,
    currentStage: advanceTo,
    stages: { ...state.stages, [stage]: accepted },
  };
}

/** 把 currentStage 拨回指定阶段并置 drafted（pivot 重生下游用）。不可变。 */
export function resetToStage(
  state: ProductLoopState,
  stage: ProductStage,
  artifactPath: string,
  now: number,
): ProductLoopState {
  return {
    ...state,
    currentStage: stage,
    stages: { ...state.stages, [stage]: { status: "drafted", artifactPath, updatedAt: now } },
  };
}
