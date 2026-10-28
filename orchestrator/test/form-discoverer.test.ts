import { expect, test } from "vitest";

import { FormDiscoverer } from "../src/web2mcp/form-discoverer.js";
import { FakePageProvider } from "../src/web2mcp/page-provider.js";
import type { PageHandle, PageProvider } from "../src/web2mcp/types.js";

test("FormDiscoverer maps page forms to form action specs", async () => {
  const provider = new FakePageProvider({
    forms: [
      {
        action: "/login",
        method: "post",
        fields: [
          { name: "email", type: "email", required: true },
          { name: "age", type: "number", required: false },
          { name: "remember", type: "checkbox", required: false },
          { name: "", type: "text", required: false },
        ],
      },
    ],
  });

  const specs = await new FormDiscoverer().discover("https://example.test", {
    pageProvider: provider,
  });

  expect(specs).toEqual([
    {
      id: "login-1",
      kind: "form",
      title: "Form 1",
      // target.url = 表单所在【页面】url（绝对），不是相对的 form.action（修复 goto 相对路径崩）
      target: { url: "https://example.test", method: "POST" },
      params: [
        { name: "email", type: "string", required: true, in: "form" },
        { name: "age", type: "number", required: false, in: "form" },
        { name: "remember", type: "boolean", required: false, in: "form" },
      ],
      needsAuth: false,
    },
  ]);
});

test("FormDiscoverer passes storage state, respects maxActions, and closes the page", async () => {
  let openedWith: { url: string; storageStatePath?: string } | undefined;
  let closed = false;
  const handle: PageHandle = {
    forms: async () => [
      { action: "/first", method: "GET", fields: [] },
      { action: "/second", method: "POST", fields: [] },
    ],
    capturedRequests: async () => [],
    close: async () => {
      closed = true;
    },
  };
  const provider: PageProvider = {
    open: async (url, opts) => {
      openedWith = { url, storageStatePath: opts?.storageStatePath };
      return handle;
    },
  };

  const specs = await new FormDiscoverer().discover("https://example.test/forms", {
    storageStatePath: "state.json",
    maxActions: 1,
    pageProvider: provider,
  });

  expect(openedWith).toEqual({
    url: "https://example.test/forms",
    storageStatePath: "state.json",
  });
  expect(specs.map((spec) => spec.id)).toEqual(["first-1"]);
  expect(closed).toBe(true);
});

test("FormDiscoverer closes the page when reading forms fails", async () => {
  let closed = false;
  const provider: PageProvider = {
    open: async () => ({
      forms: async () => {
        throw new Error("cannot inspect forms");
      },
      capturedRequests: async () => [],
      close: async () => {
        closed = true;
      },
    }),
  };

  await expect(
    new FormDiscoverer().discover("https://example.test", { pageProvider: provider }),
  ).rejects.toThrow("cannot inspect forms");
  expect(closed).toBe(true);
});
