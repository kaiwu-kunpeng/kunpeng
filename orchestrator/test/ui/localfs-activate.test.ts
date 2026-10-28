import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

describe("localfs 客户端归属激活", () => {
  test("clientScript 语法有效(防 SPA 崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });
  test("含登记函数 + poll/result 带 clientId + 403 停轮询", () => {
    expect(clientScript).toContain("function localfsRegister");
    expect(clientScript).toContain("api/localfs/authorize");
    expect(clientScript).toContain("clientId=");
    expect(clientScript).toContain("localfsClientId");
    expect(clientScript).toContain("r.status === 403");
    expect(clientScript).toContain("localfsRegistered");
  });
});