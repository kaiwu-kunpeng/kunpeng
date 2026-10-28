import { expect, test } from "vitest";
import { createLogger } from "../src/runtime/logger.js";

function capture(opts: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const log = createLogger({ sink: (l) => lines.push(l), now: () => 1000, ...opts });
  return { log, lines };
}

test("json mode emits one JSON line per record with ts/level/msg + context", () => {
  const { log, lines } = capture({ json: true, minLevel: "info", context: { planId: "plan-x" } });
  log.info("phase start", { phase: 0 });
  expect(lines).toHaveLength(1);
  const rec = JSON.parse(lines[0]);
  expect(rec).toMatchObject({ ts: 1000, level: "info", msg: "phase start", planId: "plan-x", phase: 0 });
});

test("child merges correlation context (flowId) into every record", () => {
  const { log, lines } = capture({ json: true, minLevel: "info", context: { planId: "plan-x" } });
  const flowLog = log.child({ flowId: "p0-0-0" });
  flowLog.warn("rolled back");
  const rec = JSON.parse(lines[0]);
  expect(rec.planId).toBe("plan-x");
  expect(rec.flowId).toBe("p0-0-0");
});

test("minLevel filters below-threshold records", () => {
  const { log, lines } = capture({ json: true, minLevel: "warn" });
  log.info("noise");
  log.error("boom");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]).msg).toBe("boom");
});

test("pretty mode renders [level] msg · k=v", () => {
  const { log, lines } = capture({ json: false, minLevel: "info", context: { flowId: "f1" } });
  log.info("doing", { stage: "verify" });
  expect(lines[0]).toBe("[info] doing · flowId=f1 stage=verify");
});
