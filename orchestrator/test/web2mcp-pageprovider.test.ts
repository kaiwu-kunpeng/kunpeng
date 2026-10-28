import { expect, test } from "vitest";
import { FakePageProvider } from "../src/web2mcp/page-provider.js";
import type { CapturedRequest, PageForm } from "../src/web2mcp/types.js";

test("FakePageProvider returns canned forms and requests", async () => {
  const forms: PageForm[] = [
    {
      action: "https://example.test/search",
      method: "GET",
      fields: [
        { name: "q", type: "search", required: true },
        { name: "page", type: "number", required: false },
      ],
    },
  ];
  const requests: CapturedRequest[] = [
    {
      method: "POST",
      url: "https://example.test/api/search",
      postData: "{\"q\":\"kunpeng\"}",
      resourceType: "fetch",
    },
  ];
  const provider = new FakePageProvider({ forms, requests });

  const page = await provider.open("https://example.test", { storageStatePath: "state.json" });

  await expect(page.forms()).resolves.toEqual(forms);
  await expect(page.capturedRequests()).resolves.toEqual(requests);
  await expect(page.close()).resolves.toBeUndefined();
});

test("FakePageProvider defaults to empty page data", async () => {
  const provider = new FakePageProvider();
  const page = await provider.open("https://example.test");

  await expect(page.forms()).resolves.toEqual([]);
  await expect(page.capturedRequests()).resolves.toEqual([]);
});
