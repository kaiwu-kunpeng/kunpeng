// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

type FetchCall = { url: string; body?: string };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function planBranch(): string {
  const match = /if \(action === "plan"\) \{([\s\S]*?)\n {8}\}/.exec(clientScript);
  return match?.[1] ?? "";
}

function buttonByText(text: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll("button"));
  const button = buttons.find((el) => el.textContent === text);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

describe("editable plan gate", () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
    window.location.hash = "#/project/kp/plans";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.startsWith("/api/view")) return { text: async () => "" };
      return { ok: true, json: async () => ({ ok: true, note: "ok" }) };
    }));
  });

  test("client script parses and plan branch uses the editable overlay", () => {
    expect(() => new Function(clientScript)).not.toThrow();
    expect(clientScript).toContain("editablePlanOverlay");
    expect(clientScript).toContain("plan-edit");

    const branch = planBranch();
    expect(branch).toContain("editablePlanOverlay");
    expect(branch).not.toMatch(/(?:window\.)?prompt\s*\(/);
  });

  test("submits reviewed multiline markdown through /api/plan", async () => {
    new Function(clientScript)();
    await tick();
    await tick();

    document.getElementById("view")!.innerHTML = '<button type="button" data-action="plan">起方案</button>';
    document.querySelector<HTMLButtonElement>('[data-action="plan"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const textarea = document.querySelector<HTMLTextAreaElement>(".plan-edit");
    expect(textarea).toBeTruthy();
    const inlineMd = "# 方案\\n\\n- 先审阅\\n- 再启动";
    textarea!.value = inlineMd;

    buttonByText("审阅后启动").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    const planCall = calls.find((call) => call.url === "/api/plan");
    expect(planCall).toBeTruthy();
    expect(JSON.parse(planCall!.body || "{}")).toMatchObject({
      projectId: "kp",
      inlineMd,
    });
  });
});
