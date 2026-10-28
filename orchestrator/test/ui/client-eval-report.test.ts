// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

type FetchCall = { url: string; method: string };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("client eval-report action", () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
    window.location.hash = "#/evolution-curve";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method || "GET" });
      if (url.startsWith("/api/state")) {
        return { ok: true, json: async () => ({ projects: [{ id: "current", name: "current" }] }) };
      }
      if (url.startsWith("/api/view")) {
        return { ok: true, text: async () => "" };
      }
      if (url.startsWith("/api/eval-report")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            report: {
              delta: 0.2,
              improved: true,
              baselinePassK: 0.6,
              candidatePassK: 0.8,
              markdown: "## 差分\n应用后 +20.0% 通过率",
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }));
  });

  test("fetches eval report and shows markdown in overlay", async () => {
    new Function(clientScript)();
    await tick();
    await tick();

    document.getElementById("view")!.innerHTML = '<button data-action="eval-report" data-id="prop-1">差分报告</button>';
    document.querySelector<HTMLButtonElement>("[data-action='eval-report']")!.click();
    await tick();
    await tick();

    const reportCall = calls.find((call) => call.url.startsWith("/api/eval-report"));
    expect(reportCall?.method).toBe("GET");
    expect(reportCall?.url).toContain("id=prop-1");
    expect(document.body.textContent).toContain("+20.0%");
    expect(document.querySelector(".kp-overlay")?.textContent).toContain("+20.0%");
  });
});
