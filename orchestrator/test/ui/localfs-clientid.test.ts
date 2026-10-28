import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

describe("localfs clientId P1", () => {
  test("clientScript 语法有效(防 SPA 崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });
  test("含 localfsClientId helper + localStorage 持久化 + 兜底", () => {
    expect(clientScript).toContain("function localfsClientId");
    expect(clientScript).toContain("kp-localfs-client");
    expect(clientScript).toContain("localStorage.getItem");
    expect(clientScript).toContain("localStorage.setItem");
  });
});