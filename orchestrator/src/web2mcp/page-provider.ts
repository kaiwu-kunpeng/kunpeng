import type { CapturedRequest, PageForm, PageHandle, PageProvider } from "./types.js";

export interface FakePageProviderData {
  forms?: PageForm[];
  requests?: CapturedRequest[];
}

class PlaywrightPageProvider implements PageProvider {
  async open(url: string, opts?: { storageStatePath?: string }): Promise<PageHandle> {
    let playwright: typeof import("playwright");

    try {
      playwright = await import("playwright");
    } catch (error) {
      const cause = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(`web2mcp 需要 playwright 才能打开真实网页${cause}`, { cause: error });
    }

    const browser = await playwright.chromium.launch();
    const context = await browser.newContext(
      opts?.storageStatePath ? { storageState: opts.storageStatePath } : undefined,
    );
    const captured: CapturedRequest[] = [];
    const page = await context.newPage();

    page.on("request", (request) => {
      captured.push({
        method: request.method(),
        url: request.url(),
        postData: request.postData() ?? undefined,
        resourceType: request.resourceType(),
      });
    });

    await page.goto(url, { waitUntil: "networkidle" });

    return {
      forms: async () =>
        page.$$eval("form", (forms) =>
          forms.map((form) => ({
            action: form.getAttribute("action") ?? "",
            method: form.getAttribute("method") ?? "GET",
            fields: Array.from(form.querySelectorAll("input, select, textarea")).map((field) => ({
              name: field.getAttribute("name") ?? "",
              type:
                field instanceof HTMLInputElement
                  ? field.type
                  : field.tagName.toLowerCase(),
              required: field.hasAttribute("required"),
            })),
          })),
        ),
      capturedRequests: async () => captured,
      close: async () => {
        await context.close();
        await browser.close();
      },
    };
  }
}

export class FakePageProvider implements PageProvider {
  constructor(private readonly data: FakePageProviderData = {}) {}

  async open(_url: string, _opts?: { storageStatePath?: string }): Promise<PageHandle> {
    return {
      forms: async () => this.data.forms ?? [],
      capturedRequests: async () => this.data.requests ?? [],
      close: async () => undefined,
    };
  }
}

export function defaultPageProvider(): PageProvider {
  return new PlaywrightPageProvider();
}
