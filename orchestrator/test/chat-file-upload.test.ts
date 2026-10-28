import { test, expect } from "vitest";
import { handleUpload, resolveUploads, composeUserMessage } from "../src/server/workspace-endpoints.js";
import { clientScript } from "../src/server/ui/client.js";

const b64 = Buffer.from("hello-kunpeng").toString("base64");

test("上传:pptx/xlsx 被接受并分流为 file 类", async () => {
  const ppt = await handleUpload({ name: "方案.pptx", dataUrl: "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64," + b64 });
  const xls = await handleUpload({ name: "表格.xlsx", dataUrl: "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + b64 });
  expect(ppt.ok).toBe(true);
  expect(xls.ok).toBe(true);
  expect(ppt.kind).toBe("file");
  const ids = [ppt.id, xls.id].filter((x): x is string => typeof x === "string");
  expect(ids.length).toBe(2);
  const got = resolveUploads(ids);
  expect(got.files.length).toBe(2);
  expect(got.files.map((f) => f.name)).toContain("方案.pptx");
  expect(got.images.length).toBe(0);
});

test("上传:图片仍走 image 类;可执行文件被拒", async () => {
  const img = await handleUpload({ name: "a.png", dataUrl: "data:image/png;base64," + b64 });
  expect(img.ok).toBe(true);
  expect(img.kind).toBe("image");
  const ids = [img.id].filter((x): x is string => typeof x === "string");
  expect(resolveUploads(ids).images.length).toBe(1);
  const exe = await handleUpload({ name: "x.exe", dataUrl: "data:application/octet-stream;base64," + b64 });
  expect(exe.ok).toBe(false);
});

test("提示词:文件原名+路径+解析指令进入用户消息", () => {
  const msg = composeUserMessage("总结一下这份方案", [], [{ path: "/tmp/uploads/abc.pptx", name: "方案.pptx" }], false);
  expect(msg).toContain("总结一下这份方案");
  expect(msg).toContain("/tmp/uploads/abc.pptx");
  expect(msg).toContain("方案.pptx");
  expect(msg).toMatch(/解析|读取/);
});

test("前端:对话框接受非图片附件(双向锁)", () => {
  expect(clientScript).toContain("uploadAttachment");
  expect(clientScript).not.toContain("uploadImage(fs[i])");
});