import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";

const clientSrc = clientSource();

describe("localfs 按会话绑定(作者验收)", () => {
  it("IndexedDB key 带会话前缀且保留 global 回退", () => {
    expect(clientSrc).toContain('"conv:"');
    expect(clientSrc).toContain('"global"');
  });
  it("库版本升到 2", () => {
    expect(clientSrc).toContain('indexedDB.open("kp-localfs", 2)');
  });
  it("切换会话重置 localfs 状态", () => {
    expect(clientSrc.includes("localfsResetForConversation") || clientSrc.includes("localfsReloadForConv")).toBe(true);
  });
});
