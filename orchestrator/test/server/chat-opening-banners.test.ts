import { describe, expect, test } from "vitest";
import { workerBannerHtml } from "../../src/server/worker/chat-wiring.js";
import { chatRunKey, createChatRun } from "../../src/server/chat-run-bus.js";
import type { WorkerConnection } from "../../src/server/worker/worker-connections.js";

function machine(over: Partial<WorkerConnection> = {}): WorkerConnection {
  return {
    connId: "c1",
    accountId: "acct-1",
    machineId: "a".repeat(32),
    machineName: "笔记本",
    root: "/work",
    connectedAt: 1000,
    ...over,
  };
}

describe("workerBannerHtml", () => {
  test("没有工作机时是 error 横幅并说清后果", () => {
    const html = workerBannerHtml(null);
    expect(html).toContain("kp-ev-error");
    expect(html).toContain("没有在线工作机");
    expect(html).toContain("kunpeng worker");
  });

  test("接上时报出工作机名与 root", () => {
    const html = workerBannerHtml(machine());
    expect(html).toContain("kp-ev-stage");
    expect(html).toContain("已接入工作机");
    expect(html).toContain("笔记本");
    expect(html).toContain("/work");
  });

  test("工作机名与 root 里的 HTML 被转义,不会注入", () => {
    const html = workerBannerHtml(machine({ machineName: '<img src=x onerror=alert(1)>', root: '"><script>' }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
  });
});

describe("开场横幅必须走 run.emit 才回放得到", () => {
  test("run.emit 的帧带 id 且能回放给后来的订阅者;直写响应的帧不进回放", () => {
    const run = createChatRun(chatRunKey("u1", "conv-banner-1"));

    const direct: string[] = [];
    const early = { write: (chunk: string) => { direct.push(chunk); } };
    run.subscribe(early, 0);
    early.write("data: 直写的帧（没经过 run）\n\n");

    run.emit(workerBannerHtml(machine()));

    const replayed: string[] = [];
    run.subscribe({ write: (chunk: string) => { replayed.push(chunk); } }, 0);
    const replayText = replayed.join("");

    expect(replayText).toContain("id: 1");
    expect(replayText).toContain("已接入工作机");
    expect(replayText).not.toContain("直写的帧");
    run.endRun();
  });
});