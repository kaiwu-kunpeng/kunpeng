export interface FlowSnap {
  flowId: string;
  stage: string;
  status: string;
  startedAt: number;
  updatedAt: number;
}

export interface HealthAlert {
  flowId: string;
  kind: "stuck" | "long-running";
  ageMs: number;
  stage: string;
}

export interface HealthReport {
  alerts: HealthAlert[];
  running: number;
  healthy: number;
}

export function assessFlowHealth(
  flows: FlowSnap[],
  now: number,
  opts?: { stuckMs?: number; longMs?: number }
): HealthReport {
  const stuckMs = opts?.stuckMs ?? 600000; // 10 minutes
  const longMs = opts?.longMs ?? 1800000; // 30 minutes

  const alerts: HealthAlert[] = [];
  let running = 0;

  for (const flow of flows) {
    if (flow.status !== "running") {
      continue;
    }

    running++;

    const ageMs = now - flow.updatedAt;
    const durationMs = now - flow.startedAt;

    if (ageMs > stuckMs) {
      alerts.push({
        flowId: flow.flowId,
        kind: "stuck",
        ageMs,
        stage: flow.stage,
      });
    } else if (durationMs > longMs) {
      alerts.push({
        flowId: flow.flowId,
        kind: "long-running",
        ageMs,
        stage: flow.stage,
      });
    }
  }

  const healthy = running - alerts.length;

  return {
    alerts,
    running,
    healthy,
  };
}
