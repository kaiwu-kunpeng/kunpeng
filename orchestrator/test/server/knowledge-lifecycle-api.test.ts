import { clientSource } from "../helpers/client-source.js";
import { httpSource } from "../helpers/http-source.js";
import { describe, it, expect } from "vitest";

describe("知识生命周期入口（源码级接线断言）", () => {
  const http = httpSource();
  const client = clientSource();

  it("http.ts 挂了 knowledge-edit / knowledge-delete 两端点并调用 store 方法", () => {
    const editIdx = http.indexOf('"/api/knowledge-edit"');
    const delIdx = http.indexOf('"/api/knowledge-delete"');
    expect(editIdx).toBeGreaterThan(-1);
    expect(delIdx).toBeGreaterThan(-1);
    expect(http.slice(editIdx, editIdx + 2500)).toContain("editCapture");
    expect(http.slice(delIdx, delIdx + 2000)).toContain("deleteCapture");
  });

  it("client 源码 卡片带编辑/删除按钮，删除走两步武装确认，不用 window.confirm", () => {
    expect(client).toContain('data-action="knowledge-edit"');
    expect(client).toContain('data-action="knowledge-delete"');
    expect(client).toContain('data-action="knowledge-edit-save"');
    const delIdx = client.indexOf('action === "knowledge-delete"');
    expect(delIdx).toBeGreaterThan(-1);
    expect(client.slice(delIdx, delIdx + 1500)).toContain("data-armed");
    expect(client.slice(delIdx, delIdx + 1500)).not.toContain("window.confirm");
  });
});
