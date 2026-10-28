import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { servePwaStatic } from "../../src/server/beacon-static.js";
import { handleLocalFsHttpRoute } from "../../src/server/localfs/http-route.js";
import { parseConversationRoute, conversationStore } from "../../src/server/conversation-glue.js";

const httpTs = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "http.ts"),
  "utf8",
);

describe("step23 三叶析出", () => {
  it("http.ts 不再定义三组函数", () => {
    expect(httpTs).not.toContain("async function serveBeacon");
    expect(httpTs).not.toContain("function servePwaStatic");
    expect(httpTs).not.toContain("async function serveVendorStatic");
    expect(httpTs).not.toContain("async function handleLocalFsHttpRoute");
    expect(httpTs).not.toContain("function conversationStore");
    expect(httpTs).not.toContain("async function captureConversationSearches");
    expect(httpTs).toContain("startDashboard");
  });

  it("三叶可独立调用", async () => {
    expect(typeof servePwaStatic).toBe("function");
    expect(typeof handleLocalFsHttpRoute).toBe("function");
    expect(parseConversationRoute("/api/conversations/abc")).toBeTruthy();
    expect(typeof conversationStore).toBe("function");
  });
});