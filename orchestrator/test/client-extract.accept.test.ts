import { clientSource } from "./helpers/client-source.js";
import { wsEndpointsSource } from "./helpers/ws-source.js";
import { describe, expect, it } from "vitest";

const clientSrc = clientSource();
const wsSrc = wsEndpointsSource();

describe("浏览器端提取与异地拦截(作者验收)", () => {
  it("zip 读取三件套存在(EOCD/central/deflate-raw)", () => {
    expect(clientSrc).toContain("kpZipEntries");
    expect(clientSrc).toContain("kpZipRead");
    expect(clientSrc).toContain('deflate-raw');
    expect(/0x06054b50|101010256/.test(clientSrc)).toBe(true);
  });
  it("office 提取覆盖三格式且带页/表标记", () => {
    expect(clientSrc).toContain("kpOfficeExtract");
    expect(clientSrc).toContain("sharedStrings");
    expect(clientSrc.includes("【第") || clientSrc.includes("\\u3010\\u7B2C")).toBe(true);
  });
  it("异地判定与拦截话术", () => {
    expect(clientSrc).toContain("kpIsRemoteHost");
    expect(clientSrc.includes("原始文件未上传") || clientSrc.includes("\\u539F\\u59CB\\u6587\\u4EF6\\u672A\\u4E0A\\u4F20")).toBe(true);
    expect(clientSrc.includes("不上传原始材料") || clientSrc.includes("\\u4E0D\\u4E0A\\u4F20\\u539F\\u59CB\\u6750\\u6599")).toBe(true);
  });
  it("服务端话术识别提取附件", () => {
    expect(wsSrc).toContain("extracted.txt");
  });
});
