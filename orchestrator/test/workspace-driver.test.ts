import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceTranscript } from "../src/runtime/workspace-transcript.js";
import { WorkspaceDriver, type DriverEvent, type LoopHandle, type RunLoop } from "../src/loop/workspace-driver.js";

// fake loop:stage -> 2xtoken -> gate -> (等答复) -> usage -> done。
// answerGate 无竞态:未挂起则暂存 decision。
function fakeLoop(): { runLoop: RunLoop; answered: string[] } {
  const answered: string[] = [];
  const runLoop: RunLoop = (): LoopHandle => {
    let resolveGate: ((d: string) => void) | null = null;
    let pending: string | null = null;
    async function* gen(): AsyncGenerator<DriverEvent> {
      yield { type: "stage", stage: "impl" };
      yield { type: "token", text: "Hello" };
      yield { type: "token", text: " world" };
      yield { type: "gate-needed", gateId: "g1", what: "合并?" };
      const decision = await new Promise<string>((r) => {
        if (pending != null) r(pending);
        else resolveGate = r;
      });
      answered.push(decision);
      yield { type: "usage", input: 10, output: 5, model: "test" };
      yield { type: "done", summary: "ok" };
    }
    return {
      events: gen(),
      answerGate: (_g, d) => {
        if (resolveGate) resolveGate(d);
        else pending = d;
      },
    };
  };
  return { runLoop, answered };
}

test("say 流式吐事件、门往返续跑、transcript 落库可回放", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wsdrv-"));
  const transcript = createWorkspaceTranscript(dir);
  const { runLoop, answered } = fakeLoop();
  const driver = new WorkspaceDriver({ runLoop, transcript });

  const seen: DriverEvent[] = [];
  const it = driver.say("ws1", "做点事")[Symbol.asyncIterator]();
  for (let i = 0; i < 4; i++) {
    const { value } = await it.next();
    seen.push(value as DriverEvent);
  }
  expect(seen.map((e) => e.type)).toEqual(["stage", "token", "token", "gate-needed"]);
  expect(driver.status("ws1")).toBe("awaiting-gate");

  driver.answerGate("ws1", "g1", "yes");
  for (;;) {
    const { value, done } = await it.next();
    if (done) break;
    seen.push(value as DriverEvent);
  }
  expect(answered).toEqual(["yes"]);
  expect(seen.map((e) => e.type)).toContain("done");
  expect(driver.status("ws1")).toBe("idle");

  const all = driver.getTranscript("ws1");
  expect(all.length).toBeGreaterThanOrEqual(6);
  expect(all[0].seq).toBe(1);
  const tail = driver.getTranscript("ws1", all[1].seq);
  expect(tail.every((e) => e.seq > all[1].seq)).toBe(true);
});
