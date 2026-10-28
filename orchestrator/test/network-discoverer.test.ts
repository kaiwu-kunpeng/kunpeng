import { expect, test } from "vitest";
import { NetworkDiscoverer } from "../src/web2mcp/network-discoverer.js";
import { FakePageProvider } from "../src/web2mcp/page-provider.js";
import type { CapturedRequest, PageHandle, PageProvider } from "../src/web2mcp/types.js";

test("discovers non-GET xhr/fetch requests with query and JSON body params", async () => {
  const provider = new FakePageProvider({
    requests: [
      {
        method: "POST",
        url: "https://example.test/api/items?draft=true&page=2",
        postData: "{\"name\":\"desk\",\"count\":3,\"active\":false}",
        resourceType: "fetch",
      },
    ],
  });

  const actions = await new NetworkDiscoverer().discover("https://example.test", { pageProvider: provider });

  expect(actions).toEqual([
    {
      id: "post-api-items",
      kind: "network",
      title: "POST /api/items",
      target: { url: "https://example.test/api/items?draft=true&page=2", method: "POST" },
      params: [
        { name: "draft", type: "boolean", required: false, in: "query" },
        { name: "page", type: "number", required: false, in: "query" },
        { name: "name", type: "string", required: true, in: "body" },
        { name: "count", type: "number", required: true, in: "body" },
        { name: "active", type: "boolean", required: true, in: "body" },
      ],
      needsAuth: true,
    },
  ]);
});

test("filters GET and non-network resources, dedupes by method and url, then applies maxActions", async () => {
  const requests: CapturedRequest[] = [
    { method: "GET", url: "https://example.test/api/items", resourceType: "fetch" },
    { method: "POST", url: "https://example.test/api/items", postData: "{\"a\":1}", resourceType: "fetch" },
    { method: "POST", url: "https://example.test/api/items", postData: "{\"a\":2}", resourceType: "fetch" },
    { method: "PUT", url: "https://example.test/api/items/1", postData: "{\"name\":\"new\"}", resourceType: "xhr" },
    { method: "POST", url: "https://example.test/beacon", resourceType: "image" },
  ];
  const provider = new FakePageProvider({ requests });

  const actions = await new NetworkDiscoverer().discover("https://example.test", {
    pageProvider: provider,
    maxActions: 1,
  });

  expect(actions).toHaveLength(1);
  expect(actions[0]?.target).toEqual({ url: "https://example.test/api/items", method: "POST" });
  expect(actions[0]?.params).toEqual([{ name: "a", type: "number", required: true, in: "body" }]);
});

test("passes storageStatePath to provider and closes the page", async () => {
  let openedWith: { storageStatePath?: string } | undefined;
  let closed = false;
  const page: PageHandle = {
    forms: async () => [],
    capturedRequests: async () => [
      { method: "PATCH", url: "https://example.test/api/me", postData: "{\"name\":\"Ada\"}", resourceType: "xhr" },
    ],
    close: async () => {
      closed = true;
    },
  };
  const provider: PageProvider = {
    open: async (_url, opts) => {
      openedWith = opts;
      return page;
    },
  };

  await expect(
    new NetworkDiscoverer().discover("https://example.test", {
      storageStatePath: "state.json",
      pageProvider: provider,
    }),
  ).resolves.toHaveLength(1);

  expect(openedWith).toEqual({ storageStatePath: "state.json" });
  expect(closed).toBe(true);
});
