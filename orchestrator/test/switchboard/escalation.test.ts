import { describe, expect, test } from "vitest";
import { findEscalations } from "../../src/switchboard/escalation.js";
import type { SwitchMessage } from "../../src/switchboard/store.js";

function msg(overrides: Partial<SwitchMessage> = {}): SwitchMessage {
  return {
    id: "m1",
    from: "main",
    to: "cockpit",
    body: "help",
    ts: 1000,
    read: false,
    ...overrides,
  };
}

describe("findEscalations", () => {
  test("returns recipient-offline for unread urgent direct messages whose recipient is offline", () => {
    const message = msg({ urgent: true, read: false, to: "cockpit", ts: 1000 });

    expect(findEscalations({ messages: [message], online: [], now: 1000 })).toEqual([
      { message, reason: "recipient-offline" },
    ]);
  });

  test("does not escalate unread urgent direct messages before stale timeout when recipient is online", () => {
    const message = msg({ urgent: true, read: false, to: "cockpit", ts: 1000 });

    expect(findEscalations({ messages: [message], online: ["cockpit"], now: 1010, staleMs: 1000 })).toEqual([]);
  });

  test("returns stale-unread for unread urgent direct messages after stale timeout when recipient is online", () => {
    const message = msg({ urgent: true, read: false, to: "cockpit", ts: 1000 });

    expect(findEscalations({ messages: [message], online: ["cockpit"], now: 3000, staleMs: 1000 })).toEqual([
      { message, reason: "stale-unread" },
    ]);
  });

  test("does not escalate non-urgent unread messages", () => {
    const message = msg({ read: false, to: "cockpit", urgent: undefined });

    expect(findEscalations({ messages: [message], online: [], now: 1000 })).toEqual([]);
  });

  test("does not escalate read urgent messages", () => {
    const message = msg({ urgent: true, read: true, to: "cockpit" });

    expect(findEscalations({ messages: [message], online: [], now: 1000 })).toEqual([]);
  });

  test("escalates broadcast messages only by stale timeout", () => {
    const message = msg({ urgent: true, read: false, to: "all", ts: 1000 });

    expect(findEscalations({ messages: [message], online: [], now: 3000, staleMs: 1000 })).toEqual([
      { message, reason: "stale-unread" },
    ]);
  });
});
