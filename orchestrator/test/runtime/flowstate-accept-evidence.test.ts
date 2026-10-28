import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowTracker } from "../../src/runtime/flowstate.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-accept-evidence-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("setAcceptEvidence 浅合并、不推 history、未知流静默", async () => {
  const t = new FlowTracker(join(dir, "state"), () => 1_700_000_000_000);
  await t.start("e1", "req");
  const before = (await t.read("e1"))!.history.length;
  await t.setAcceptEvidence("e1", { baseline: { passed: false, exitCode: 1, at: 1, attempt: 1, logPath: "/x/1.txt" } });
  await t.setAcceptEvidence("e1", { final: { passed: true, exitCode: 0, at: 2, attempt: 2, logPath: "/x/2.txt" } });
  await t.setAcceptEvidence("e1", { diffStat: { files: 2, insertions: 5, deletions: 1 } });
  const s = (await t.read("e1"))!;
  expect(s.acceptEvidence).toEqual({
    baseline: { passed: false, exitCode: 1, at: 1, attempt: 1, logPath: "/x/1.txt" },
    final: { passed: true, exitCode: 0, at: 2, attempt: 2, logPath: "/x/2.txt" },
    diffStat: { files: 2, insertions: 5, deletions: 1 },
  });
  expect(s.history.length).toBe(before);
  await expect(t.setAcceptEvidence("nope", { diffStat: { files: 0, insertions: 0, deletions: 0 } })).resolves.toBeUndefined();
  expect(await t.read("nope")).toBeNull();
});