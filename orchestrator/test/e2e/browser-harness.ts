import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface BrowserHarness {
  baseUrl: string;
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
}

export async function createBrowserHarness(handler: RouteHandler): Promise<BrowserHarness> {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error: unknown) => {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(error instanceof Error ? error.stack ?? error.message : String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    browser,
    page,
    close: async () => {
      await browser.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export function writeSse(res: ServerResponse, html: string): void {
  res.write(`${html.split("\n").map((line) => `data: ${line}`).join("\n")}\n\n`);
}

export function endSse(res: ServerResponse): void {
  res.write("event: end\ndata: {}\n\n");
  res.end();
}
