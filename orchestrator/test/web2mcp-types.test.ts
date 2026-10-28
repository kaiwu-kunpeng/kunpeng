import { expect, test } from "vitest";
import type {
  ActionDiscoverer,
  ActionSpec,
  CapturedRequest,
  DiscoverOpts,
  FormField,
  PageForm,
  PageHandle,
  PageProvider,
  ParamSpec,
  Web2McpResult,
} from "../src/web2mcp/types.js";
import { ActionSpecSchema, ParamSpecSchema } from "../src/web2mcp/types.js";

const param: ParamSpec = { name: "email", type: "string", required: true, in: "form" };

const action: ActionSpec = {
  id: "login-form",
  kind: "form",
  title: "Login",
  target: { url: "https://example.test/login", method: "POST" },
  params: [param],
  needsAuth: false,
};

test("ActionSpecSchema accepts a valid form action", () => {
  expect(ActionSpecSchema.parse(action)).toEqual(action);
});

test("ActionSpecSchema accepts a valid network action with body and query params", () => {
  const network: ActionSpec = {
    id: "post-api",
    kind: "network",
    title: "Create item",
    target: { url: "https://example.test/api/items?draft=1", method: "POST" },
    params: [
      { name: "draft", type: "boolean", required: false, in: "query" },
      { name: "count", type: "number", required: true, in: "body" },
    ],
    needsAuth: true,
  };

  expect(ActionSpecSchema.parse(network)).toEqual(network);
});

test("schemas reject invalid enum branches", () => {
  expect(() => ParamSpecSchema.parse({ ...param, in: "header" })).toThrow();
  expect(() => ParamSpecSchema.parse({ ...param, type: "file" })).toThrow();
  expect(() => ActionSpecSchema.parse({ ...action, kind: "button" })).toThrow();
});

test("shared page abstractions are usable by discoverers", async () => {
  const field: FormField = { name: "q", type: "search", required: false };
  const form: PageForm = { action: "/search", method: "GET", fields: [field] };
  const request: CapturedRequest = {
    method: "POST",
    url: "https://example.test/api/search",
    postData: "{\"q\":\"kunpeng\"}",
    resourceType: "fetch",
  };

  const handle: PageHandle = {
    forms: async () => [form],
    capturedRequests: async () => [request],
    close: async () => undefined,
  };
  const provider: PageProvider = {
    open: async (_url: string, _opts?: { storageStatePath?: string }) => handle,
  };
  const opts: DiscoverOpts = { storageStatePath: "state.json", maxActions: 1, pageProvider: provider };
  const discoverer: ActionDiscoverer = {
    discover: async (_url: string, discoverOpts?: DiscoverOpts) => {
      const page = await discoverOpts?.pageProvider?.open("https://example.test", {
        storageStatePath: discoverOpts.storageStatePath,
      });
      await page?.close();
      return [action];
    },
  };

  await expect(opts.pageProvider?.open("https://example.test", opts)).resolves.toBe(handle);
  await expect(discoverer.discover("https://example.test", opts)).resolves.toEqual([action]);
});

test("Web2McpResult carries output metadata and action specs", () => {
  const result: Web2McpResult = { outDir: "/tmp/web2mcp", tools: 1, specs: [action] };

  expect(result.tools).toBe(1);
  expect(result.specs[0].params[0].in).toBe("form");
});
