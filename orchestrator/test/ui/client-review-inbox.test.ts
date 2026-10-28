// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

type FetchCall = { url: string; body?: string };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("client review inbox actions", () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
    window.location.hash = "#/review-inbox";
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url === "/api/state") {
        return { ok: true, json: async () => ({ projects: [{ id: "current", name: "current" }] }) };
      }
      if (url.startsWith("/api/view")) return { ok: true, text: async () => "" };
      if (url === "/api/autopilot") {
        return { ok: true, json: async () => ({ ok: true, merged: ["f1"], skipped: [], note: "自动合并 1 条，跳过 0 条" }) };
      }
      return { ok: true, json: async () => ({ ok: true, note: "ok" }) };
    }));
  });

  test("keeps review-inbox route and posts confirm-release", async () => {
    new Function(clientScript)();
    await tick();
    await tick();

    expect(calls.some((call) => call.url === "/api/view?route=%23%2Freview-inbox")).toBe(true);

    document.getElementById("view")!.innerHTML = '<button data-action="confirm-release" data-id="release-vx">确认发布</button>';
    document.querySelector("[data-action='confirm-release']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    const call = calls.find((item) => item.url === "/api/confirm-release");
    expect(call?.body).toContain('"id":"release-vx"');
  });

  test("posts approve-connector", async () => {
    new Function(clientScript)();
    await tick();
    await tick();

    document.getElementById("view")!.innerHTML = '<button data-action="approve-connector" data-id="conn-1">放行</button>';
    document.querySelector("[data-action='approve-connector']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    const call = calls.find((item) => item.url === "/api/approve-connector");
    expect(call?.body).toContain('"id":"conn-1"');
  });

  test("routes confirm-release by data-project", async () => {
    new Function(clientScript)();
    await tick();
    await tick();

    document.getElementById("view")!.innerHTML = '<button data-action="confirm-release" data-id="rel-x" data-project="proj-b">确认发布</button>';
    document.querySelector("[data-action='confirm-release']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    const call = calls.find((item) => item.url === "/api/confirm-release");
    expect(call?.body).toContain('"id":"rel-x"');
    expect(call?.body).toContain('"projectId":"proj-b"');
  });

  test("posts autopilot for the current project after confirmation", async () => {
    new Function(clientScript)();
    await tick();
    await tick();

    document.getElementById("view")!.innerHTML = '<button data-action="autopilot">⚡</button>';
    document.querySelector("[data-action='autopilot']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    expect(window.confirm).toHaveBeenCalledWith("自动合并所有【已验证】流到 main？（发布/高风险/提案不动，仍需你确认）");
    const call = calls.find((item) => item.url === "/api/autopilot");
    expect(call?.body).toContain('"projectId"');
    expect(call?.body).toContain('"projectId":"current"');
  });
});
