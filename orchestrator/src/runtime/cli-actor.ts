export function hasAgentSignal(env: Record<string, string | undefined>): boolean {
  return env.CLAUDECODE === "1" || Object.entries(env).some(([key, value]) =>
    key.startsWith("CODEX_") && typeof value === "string" && value.length > 0);
}

export function resolveCliActor(
  args: readonly string[],
  env: Record<string, string | undefined>,
): { by: "human" | "agent" | "machine"; args: string[] } {
  const actorIndex = args.indexOf("--actor");
  const remainingArgs = [...args];
  let by: "human" | "agent" | "machine";
  if (actorIndex !== -1) {
    const actor = args[actorIndex + 1];
    if (actor !== "human" && actor !== "agent" && actor !== "machine") {
      throw new Error("--actor 必须为 human、agent 或 machine");
    }
    by = actor;
    remainingArgs.splice(actorIndex, 2);
  } else {
    const actor = env.KUNPENG_ACTOR;
    by = actor === "human" || actor === "agent" || actor === "machine"
      ? actor
      : hasAgentSignal(env) ? "agent" : "human";
  }

  if (by === "human" && hasAgentSignal(env)) {
    by = "agent";
  }
  return { by, args: remainingArgs };
}
