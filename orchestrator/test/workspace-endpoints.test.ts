import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { expect, test } from "vitest";
import { streamSay } from "../src/server/workspace-endpoints.js";
import { WorkspaceDriver, type DriverEvent } from "../src/loop/workspace-driver.js";
import type { TranscriptEntry } from "../src/runtime/workspace-transcript.js";

function fakeDriver(events: DriverEvent[]): WorkspaceDriver {
  return new WorkspaceDriver({
    runLoop: () => ({
      events: (async function* () {
        for (const e of events) yield e;
      })(),
      answerGate: () => {},
    }),
    transcript: {
      append(_workspaceId: string, kind: string, data: unknown): TranscriptEntry {
        return { seq: 1, ts: 1, kind, data };
      },
      get: () => [],
    },
  });
}

test("streamSay 把事件渲成 HTML 帧并以 event: end 收尾", async () => {
  const writes: string[] = [];
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  const res: Parameters<typeof streamSay>[3] = {
    setHeader: () => response,
    write: (s: string) => {
      writes.push(s);
      return true;
    },
    end: () => response,
  };
  const events: DriverEvent[] = [
    { type: "stage", stage: "spec" },
    { type: "gate-needed", gateId: "f1", what: "合并?" },
    { type: "done", summary: "ok" },
  ];
  await streamSay(fakeDriver(events), "ws1", "做事", res);
  const joined = writes.join("");
  expect(joined).toContain("kp-ev-stage");
  expect(joined).toContain('data-gate-yes="f1"');
  expect(joined).toContain("kp-ev-done");
  expect(joined).toContain("event: end");
  expect(joined).not.toContain('"type":"stage"');
});
