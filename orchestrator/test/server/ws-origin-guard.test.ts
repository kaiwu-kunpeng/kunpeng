import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isAllowedWsOrigin } from "../../src/server/ws-origin.js";

const ptySrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "pty-endpoint.ts"),
  "utf8",
);

const HOST = "cockpit.example.com";

describe("兄弟子域必须被拒", () => {
  it("sibling-a.example.com → cockpit.example.com 拒绝", () => {
    const got = isAllowedWsOrigin({ origin: "https://sibling-a.example.com", host: HOST });
    expect(got.ok).toBe(false);
    expect(got.reason).toBe("cross-origin");
  });

  it("sibling-b.example.com → cockpit.example.com 拒绝", () => {
    expect(isAllowedWsOrigin({ origin: "https://sibling-b.example.com", host: HOST }).ok).toBe(false);
  });

  it("完全不相干的站点拒绝", () => {
    expect(isAllowedWsOrigin({ origin: "https://evil.example", host: HOST }).ok).toBe(false);
  });
});

describe("合法访问路径必须放行", () => {
  it("远程 cockpit 同 host 放行", () => {
    const got = isAllowedWsOrigin({ origin: `https://${HOST}`, host: HOST });
    expect(got.ok).toBe(true);
    expect(got.reason).toBe("same-host");
  });

  it("本机 127.0.0.1 带端口放行", () => {
    expect(isAllowedWsOrigin({ origin: "http://127.0.0.1:7788", host: "127.0.0.1:7788" }).ok).toBe(true);
  });

  it("本机 localhost 带端口放行", () => {
    expect(isAllowedWsOrigin({ origin: "http://localhost:7788", host: "localhost:7788" }).ok).toBe(true);
  });

  it("配置白名单放行", () => {
    const got = isAllowedWsOrigin({
      origin: "https://extra.example",
      host: HOST,
      extraAllowed: ["https://extra.example"],
    });
    expect(got.ok).toBe(true);
    expect(got.reason).toBe("configured");
  });
});

describe("非浏览器客户端放行（既有测试用 ws 库不发 Origin）", () => {
  it("origin 缺失放行", () => {
    const got = isAllowedWsOrigin({ host: "127.0.0.1:7788" });
    expect(got.ok).toBe(true);
    expect(got.reason).toBe("no-origin");
  });

  it("origin 为空串放行", () => {
    expect(isAllowedWsOrigin({ origin: "", host: "127.0.0.1:7788" }).reason).toBe("no-origin");
  });

  it("origin 为字面量 null 放行", () => {
    expect(isAllowedWsOrigin({ origin: "null", host: "127.0.0.1:7788" }).reason).toBe("no-origin");
  });
});

describe("边角", () => {
  it("端口不同视为跨源", () => {
    expect(isAllowedWsOrigin({ origin: "http://127.0.0.1:9999", host: "127.0.0.1:7788" }).ok).toBe(false);
  });

  it("畸形 origin 拒绝", () => {
    expect(isAllowedWsOrigin({ origin: "not-a-url", host: HOST }).ok).toBe(false);
  });

  it("不抛错", () => {
    expect(() => isAllowedWsOrigin({ origin: "://///", host: undefined })).not.toThrow();
  });
});

describe("upgrade 处理器确实消费了它", () => {
  it("引用了 isAllowedWsOrigin 且在 readAuthConfig 之前", () => {
    const originIdx = ptySrc.indexOf("isAllowedWsOrigin");
    const authIdx = ptySrc.indexOf("readAuthConfig");
    expect(originIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeGreaterThan(-1);
    expect(originIdx).toBeLessThan(authIdx);
  });

  it("拒绝时返回 403", () => {
    expect(ptySrc).toContain("403 Forbidden");
  });
});
