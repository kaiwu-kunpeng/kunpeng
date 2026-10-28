import { expect, it } from "vitest";
import { parseDrainPayload } from "./drain-parse.js";

const sample = JSON.stringify([
  {
    id: "1",
    source: "edge",
    proxy: { timestamp: 1718000000000, method: "GET", host: "www.acme.com", path: "/parts/oem/123", userAgent: ["Mozilla/5.0 (compatible; GPTBot/1.2)"], statusCode: 200 },
  },
  {
    id: "2",
    source: "static",
    proxy: { timestamp: 1718000001000, method: "GET", host: "www.acme.com", path: "/", userAgent: ["Mozilla/5.0 Chrome/120"], statusCode: 200 },
  },
  { id: "3", message: "no proxy here" },
]);

it("解析 JSON 数组、抽 proxy.userAgent(数组首元素)/path/status", () => {
  const hits = parseDrainPayload(sample);
  expect(hits.length).toBe(2); // 第3条无 proxy/UA 被丢
  expect(hits[0]).toMatchObject({ ua: "Mozilla/5.0 (compatible; GPTBot/1.2)", path: "/parts/oem/123", status: 200, host: "www.acme.com" });
});

it("解析 NDJSON、跳过畸形行不抛", () => {
  const ndjson = [
    JSON.stringify({ proxy: { path: "/a", userAgent: ["ClaudeBot/1.0"], statusCode: 200, host: "h" } }),
    "{ this is broken json",
    JSON.stringify({ proxy: { path: "/b", userAgent: "PerplexityBot/1.0", statusCode: 200, host: "h" } }),
  ].join("\n");
  const hits = parseDrainPayload(ndjson);
  expect(hits.length).toBe(2);
  expect(hits[0].ua).toContain("ClaudeBot");
  expect(hits[1].ua).toContain("PerplexityBot"); // 兼容 userAgent 为字符串
});

it("空/垃圾输入返回空数组不抛", () => {
  expect(parseDrainPayload("")).toEqual([]);
  expect(parseDrainPayload("not json at all")).toEqual([]);
});
