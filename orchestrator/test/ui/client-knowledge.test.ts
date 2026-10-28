// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

type FetchCall = { url: string; method: string; body?: string };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("client knowledge actions", () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
    window.location.hash = "#/knowledge";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ? String(init.method) : "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.startsWith("/api/state")) {
        return { ok: true, json: async () => ({ projects: [{ id: "current", name: "current" }] }) };
      }
      if (url.startsWith("/api/view")) {
        return {
          ok: true,
          text: async () => `
            <input data-knowledge-input>
            <button data-action="knowledge-search">检索</button>
            <button data-action="knowledge-clear">清空</button>
            <div id="knowledge-results"></div>
          `,
        };
      }
      if (url.startsWith("/api/knowledge-search")) {
        const params = new URL(url, "http://local").searchParams;
        const q = params.get("q") || "";
        if (!q) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              captures: [
                {
                  id: "cap-b",
                  summary: "鲲鹏",
                  source: "text",
                  tags: ["x"],
                  promoted: false,
                  createdAt: 1,
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            ok: true,
            hits: [
              {
                capture: { id: "cap-b" },
                score: 3,
                citation: { source: "text", snippet: "…鲲鹏…", matchedTerms: ["鲲鹏"] },
              },
            ],
          }),
        };
      }
      if (url === "/api/knowledge-promote") {
        return { ok: true, json: async () => ({ ok: true, note: "已 promote", promoted: true }) };
      }
      if (url === "/api/knowledge-capture") {
        return { ok: true, json: async () => ({ ok: true, id: "cap-x", note: "已捕获" }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }));
  });

  test("keeps #/knowledge route, promotes, and renders search results", async () => {
    new Function(clientScript)();
    await tick();
    await tick();
    await tick();

    const initialViewCall = calls.find((call) => call.url.startsWith("/api/view"));
    expect(initialViewCall?.url).toContain(encodeURIComponent("#/knowledge"));
    expect(initialViewCall?.url).not.toContain(encodeURIComponent("#/overview"));

    const initialKnowledgeCall = calls.find((call) => {
      if (!call.url.startsWith("/api/knowledge-search")) return false;
      const params = new URL(call.url, "http://local").searchParams;
      return (params.get("q") || "") === "";
    });
    expect(initialKnowledgeCall?.method).toBe("GET");
    expect(initialKnowledgeCall?.url).toContain("projectId=current");
    expect(document.getElementById("knowledge-results")?.innerHTML).toContain("cap-b");

    const view = document.getElementById("view")!;
    view.innerHTML = '<button data-action="knowledge-promote" data-id="cap-b">promote</button>';
    view.querySelector("[data-action='knowledge-promote']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    const promoteCall = calls.find((call) => call.url === "/api/knowledge-promote");
    expect(promoteCall?.method).toBe("POST");
    expect(promoteCall?.body).toContain('"id":"cap-b"');

    view.innerHTML = `
      <input data-knowledge-input value="鲲鹏">
      <button data-action="knowledge-search">检索</button>
      <div id="knowledge-results"></div>
    `;
    view.querySelector("[data-action='knowledge-search']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    const searchCall = calls.find((call) => {
      if (!call.url.startsWith("/api/knowledge-search")) return false;
      const params = new URL(call.url, "http://local").searchParams;
      return params.get("q") === "鲲鹏";
    });
    expect(searchCall?.method).toBe("GET");
    expect(searchCall?.url).toContain("projectId=current");
    expect(searchCall?.url).toContain("q=" + encodeURIComponent("鲲鹏"));
    expect(document.getElementById("knowledge-results")?.innerHTML).toContain("cap-b");
  });

  test("posts pasted text to knowledge capture endpoint", async () => {
    new Function(clientScript)();
    await tick();
    await tick();
    await tick();
    calls = [];

    const view = document.getElementById("view")!;
    view.innerHTML = `
      <textarea data-knowledge-capture-input>新知识</textarea>
      <button data-action="knowledge-capture">捕获</button>
      <div id="knowledge-results"></div>
    `;
    view.querySelector("[data-action='knowledge-capture']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    const captureCall = calls.find((call) => call.url === "/api/knowledge-capture");
    expect(captureCall?.method).toBe("POST");
    expect(captureCall?.body).toContain('"projectId":"current"');
    expect(captureCall?.body).toContain('"text":"新知识"');
  });

  test("posts pasted URL to knowledge capture endpoint", async () => {
    new Function(clientScript)();
    await tick();
    await tick();
    await tick();
    calls = [];

    const view = document.getElementById("view")!;
    view.innerHTML = `
      <input data-knowledge-capture-url value="https://x.test/a">
      <button data-action="knowledge-capture-url">抓取并整理</button>
      <div id="knowledge-results"></div>
    `;
    view.querySelector("[data-action='knowledge-capture-url']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    const captureCall = calls.find((call) => call.url === "/api/knowledge-capture");
    expect(captureCall?.method).toBe("POST");
    expect(captureCall?.body).toContain('"kind":"url"');
    expect(captureCall?.body).toContain('"value":"https://x.test/a"');
  });
});
