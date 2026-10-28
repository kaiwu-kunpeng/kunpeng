// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

type FetchCall = { url: string; body?: string };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("前端确认发布走两步（作者锁定）", () => {
  let calls: FetchCall[];
  let confirmAnswers: boolean[];

  beforeEach(() => {
    calls = [];
    confirmAnswers = [];
    document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
    window.location.hash = "#/review-inbox";
    vi.stubGlobal("confirm", vi.fn(() => (confirmAnswers.length ? confirmAnswers.shift()! : true)));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url, body });
      if (url === "/api/state") return { ok: true, json: async () => ({ projects: [{ id: "current", name: "current" }] }) };
      if (url.startsWith("/api/view")) return { ok: true, text: async () => "" };
      if (url === "/api/confirm-release") {
        if (body && body.includes("confirmToken")) return { ok: true, json: async () => ({ ok: true, note: "已确认发布" }) };
        return { ok: true, json: async () => ({ ok: false, needConfirm: true, confirmToken: "tok123", error: "L4 硬门需二次确认" }) };
      }
      return { ok: true, json: async () => ({ ok: true, note: "ok" }) };
    }));
  });

  async function clickRelease(): Promise<void> {
    new Function(clientScript)();
    await tick();
    await tick();
    document.getElementById("view")!.innerHTML = '<button data-action="confirm-release" data-id="rel-9" data-project="proj-b">确认发布</button>';
    document.querySelector("[data-action='confirm-release']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let i = 0; i < 6; i += 1) await tick();
  }

  test("两次确认都点是 → 两次 POST，第二次带服务端给的令牌", async () => {
    confirmAnswers = [true, true];
    await clickRelease();
    const posts = calls.filter((c) => c.url === "/api/confirm-release");
    expect(posts.length).toBe(2);
    expect(JSON.parse(posts[0]!.body!).confirmToken).toBeUndefined();
    expect(posts[1]!.body).toContain('"confirmToken":"tok123"');
    expect(posts[1]!.body).toContain('"projectId":"proj-b"');
    expect(posts[1]!.body).toContain('"id":"rel-9"');
  });

  test("二次确认点否 → 只有一次 POST，不带令牌", async () => {
    confirmAnswers = [true, false];
    await clickRelease();
    const posts = calls.filter((c) => c.url === "/api/confirm-release");
    expect(posts.length).toBe(1);
    expect(JSON.parse(posts[0]!.body!).confirmToken).toBeUndefined();
  });
});