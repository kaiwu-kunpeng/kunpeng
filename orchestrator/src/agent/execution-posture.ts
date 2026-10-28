import { selectExecutionKind, type ExecutionKind } from "./execution-backend.js";

export interface ExecutionPosture {
  readonly kind: ExecutionKind;
  readonly localOnly: boolean;
  readonly credentialsLocal: boolean;
  readonly offlineCapable: boolean;
  readonly notes: readonly string[];
}

function hasApiKey(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function reportExecutionPosture(
  env: Record<string, string | undefined> = process.env,
): ExecutionPosture {
  const kind = selectExecutionKind(env);
  const localOnly = kind === "local";
  const credentialsLocal = !hasApiKey(env.OPENAI_API_KEY) && !hasApiKey(env.ANTHROPIC_API_KEY);
  const offlineCapable = localOnly && credentialsLocal;

  const notes: string[] = [];
  if (!localOnly) {
    notes.push("非本地后端：代码会上云");
  }
  if (!credentialsLocal) {
    notes.push("检测到第三方 API key：凭据可能外发");
  }
  if (offlineCapable) {
    notes.push("本地反位成立");
  }

  return {
    kind,
    localOnly,
    credentialsLocal,
    offlineCapable,
    notes,
  };
}
