import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

describe("localfs 标注来源 host(治'不知道哪个服务器')", () => {
  test("clientScript 语法有效(防 SPA 崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });
  test("chip/回执用 location.host 标注来源", () => {
    expect(clientScript).toContain("location.host");
    expect(clientScript).toContain("kp-localfs-host");
  });
  test("授权确认文案说明目录在当前浏览器所在机器", () => {
    expect(clientScript).toContain("你当前浏览器所在机器");
  });
});