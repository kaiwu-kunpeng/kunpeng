import { describe, expect, test } from "vitest";
import { fetchRefScrape, fetchRefText, REF_MAX_REDIRECTS } from "../../src/product/fetch-ref.js";

const publicLookup = async () => ["93.184.216.34"];
const privateLookup = async () => ["10.0.0.8"];

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  }) as typeof fetch;
  return { fn, calls };
}

describe("copy-ref 抓取的 SSRF 闸（作者锁定）", () => {
  test("公网地址：正常返回 HTML", async () => {
    const f = fakeFetch({ "https://ref.example/": () => new Response("<title>Ref</title>") });
    expect(await fetchRefText("https://ref.example/", { fetch: f.fn, lookup: publicLookup })).toBe("<title>Ref</title>");
    expect(f.calls).toEqual(["https://ref.example/"]);
  });

  test("回环 / 内网字面地址、DNS 解析到内网、非 http 协议：不发请求直接拒绝", async () => {
    const f = fakeFetch({});
    const loop = ["http://", "127.0.0.1", ":7788/api/accounts"].join("");
    await expect(fetchRefText(loop, { fetch: f.fn, lookup: publicLookup })).rejects.toThrow(/内网|回环/);
    await expect(fetchRefText("http://intranet.example/", { fetch: f.fn, lookup: privateLookup })).rejects.toThrow(/内网|回环/);
    await expect(fetchRefText("file:///etc/passwd", { fetch: f.fn, lookup: publicLookup })).rejects.toThrow(/http/);
    expect(f.calls).toEqual([]);
  });

  test("重定向到内网：第二跳被拦，内网地址从未被请求", async () => {
    const f = fakeFetch({
      "https://ref.example/": () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    });
    await expect(fetchRefText("https://ref.example/", { fetch: f.fn, lookup: publicLookup })).rejects.toThrow(/内网|回环/);
    expect(f.calls).toEqual(["https://ref.example/"]);
  });

  test("公网之间的重定向照常跟随；超过上限报错", async () => {
    const ok = fakeFetch({
      "https://a.example/": () => new Response(null, { status: 301, headers: { location: "/b" } }),
      "https://a.example/b": () => new Response("done"),
    });
    expect(await fetchRefText("https://a.example/", { fetch: ok.fn, lookup: publicLookup })).toBe("done");
    const loopForever = (async () => new Response(null, { status: 302, headers: { location: "https://a.example/again" } })) as typeof fetch;
    await expect(fetchRefText("https://a.example/", { fetch: loopForever, lookup: publicLookup })).rejects.toThrow(String(REF_MAX_REDIRECTS));
  });

  test("响应体超过上限按上限截断；非 2xx 报错", async () => {
    const big = fakeFetch({ "https://big.example/": () => new Response("x".repeat(5000)) });
    expect((await fetchRefText("https://big.example/", { fetch: big.fn, lookup: publicLookup, maxBytes: 100 })).length).toBe(100);
    const bad = fakeFetch({ "https://bad.example/": () => new Response("no", { status: 500 }) });
    await expect(fetchRefText("https://bad.example/", { fetch: bad.fn, lookup: publicLookup })).rejects.toThrow(/500/);
  });

  test("超时：请求在超时后被中止", async () => {
    const hang = ((_: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as typeof fetch;
    await expect(fetchRefText("https://slow.example/", { fetch: hang, lookup: publicLookup, timeoutMs: 50 })).rejects.toThrow();
  });

  test("fetchRefScrape 未注入抓取器时走 SSRF 闸：内网地址被拒", async () => {
    const loop = ["http://", "127.0.0.1", "/"].join("");
    await expect(fetchRefScrape(loop)).rejects.toThrow(/内网|回环/);
  });
});