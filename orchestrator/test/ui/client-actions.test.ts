// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

type FetchCall = { url: string; body?: string };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setActionDom(): HTMLElement {
  const view = document.getElementById("view")!;
  view.innerHTML = `
    <button id="reject-child" data-action="reject" data-id="p1"><span>拒绝</span></button>
    <button id="merge" data-action="merge-main" data-flow="f1">合并</button>
    <button id="run" data-action="run">启动</button>
  `;
  return view;
}

describe("client delegated data-action clicks", () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
    window.location.hash = "#/project/kp";
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("prompt", vi.fn(() => "x"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.startsWith("/api/view")) return { text: async () => "" };
      return { ok: true, json: async () => ({ ok: true, note: "ok" }) };
    }));
  });

  test("reject, merge-main, and run dispatch through document click delegation", async () => {
    new Function(clientScript)();
    await tick();
    await tick();

    let view = setActionDom();
    view.querySelector("#reject-child span")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    view = setActionDom();
    view.querySelector("#merge")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    view = setActionDom();
    view.querySelector("#run")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    const rejectCall = calls.find((call) => call.url === "/api/reject");
    expect(rejectCall?.body).toContain('"id":"p1"');

    const mergeCall = calls.find((call) => call.url === "/api/merge");
    expect(mergeCall?.body).toContain('"flowId":"f1"');
    expect(mergeCall?.body).toContain('"target":"main"');

    const runCall = calls.find((call) => call.url === "/api/run");
    expect(runCall?.body).toContain('"requirement":"x"');
  });

  test("gate cards send exact bodies, lock duplicate clicks, and render result or server error", async () => {
    let resolveMerge: ((value: { ok: boolean; json: () => Promise<{ ok: boolean }> }) => void) | undefined;
    const mergeResponse = new Promise<{ ok: boolean; json: () => Promise<{ ok: boolean }> }>((resolve) => {
      resolveMerge = resolve;
    });
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url === "/api/merge") return mergeResponse;
      if (url === "/api/gates/discard") {
        return Promise.resolve({ ok: true, json: async () => ({ ok: false, error: "门已被其他人处理" }) });
      }
      if (url.startsWith("/api/view")) return Promise.resolve({ text: async () => "" });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    }));

    const gateHost = document.createElement("div");
    gateHost.id = "gate-host";
    document.body.appendChild(gateHost);
    const mergeData = JSON.stringify({
      id: "flow-merge",
      planId: "plan-1",
      kind: "merge",
      title: '合并 "安全" 分支',
      branch: "kp/flow-merge",
      project: { id: "project-a", name: "项目 A" },
      createdAt: 1_700_000_000_000,
    }).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const discardData = JSON.stringify({
      id: "flow-discard",
      planId: null,
      kind: "human",
      title: "人工复核",
      branch: "kp/flow-discard",
      project: { id: "project-b", name: "项目 B" },
      createdAt: 1_700_000_000_000,
    }).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    gateHost.innerHTML = `
      <div id="merge-card" data-gate-card="${mergeData}"></div>
      <div id="discard-card" data-gate-card="${discardData}"></div>
    `;

    new Function(clientScript)();
    const mergeCard = gateHost.querySelector<HTMLElement>("#merge-card")!;
    const approve = mergeCard.querySelector<HTMLButtonElement>("[data-gate-approve]")!;
    const mergeButtons = mergeCard.querySelectorAll<HTMLButtonElement>("button");
    approve.click();
    approve.click();

    expect(calls.filter((call) => call.url === "/api/merge")).toHaveLength(1);
    expect([...mergeButtons].every((button) => button.disabled)).toBe(true);
    expect([...mergeButtons].every((button) => button.textContent === "处理中…")).toBe(true);
    expect(JSON.parse(calls.find((call) => call.url === "/api/merge")!.body!)).toEqual({
      projectId: "project-a",
      flowId: "flow-merge",
      target: "main",
    });

    resolveMerge?.({ ok: true, json: async () => ({ ok: true }) });
    await tick();
    await tick();
    expect(mergeCard.querySelector(".kp-gate-result")?.textContent).toBe("已合并 ✓");
    expect(mergeCard.querySelector("[data-gate-approve]")).toBeNull();

    const discardCard = gateHost.querySelector<HTMLElement>("#discard-card")!;
    discardCard.querySelector<HTMLButtonElement>("[data-gate-discard]")!.click();
    await tick();
    await tick();
    expect(JSON.parse(calls.find((call) => call.url === "/api/gates/discard")!.body!)).toEqual({
      flowId: "flow-discard",
    });
    expect(discardCard.querySelector(".kp-gate-result")?.textContent).toBe("门已被其他人处理");
    expect([...discardCard.querySelectorAll<HTMLButtonElement>("button")].every((button) => !button.disabled)).toBe(true);
  });
});
