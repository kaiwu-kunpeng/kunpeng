import { describe, it, expect, beforeEach } from "vitest";
import { gunzipSync } from "node:zlib";
import { vendorResponse, __clearVendorCache } from "../../src/server/vendor-static.js";

const RAW = Buffer.from("x".repeat(4096), "utf8");
const CT = "application/javascript; charset=utf-8";

describe("vendorResponse 弱网三件套", () => {
  beforeEach(() => __clearVendorCache());

  it("gzip 客户端:200+content-encoding gzip,解压等于原文,带 etag/vary/cache-control", async () => {
    const r = await vendorResponse("a.js", CT, async () => RAW, { acceptEncoding: "gzip" });
    expect(r.status).toBe(200);
    expect(r.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(r.body as Buffer).equals(RAW)).toBe(true);
    expect(r.headers["etag"]).toMatch(/^"[0-9a-f]{40}"$/);
    expect(r.headers["vary"]).toBe("accept-encoding");
    expect(r.headers["cache-control"]).toContain("max-age=604800");
    expect(r.headers["content-type"]).toBe(CT);
  });

  it("不接受 gzip:200 原文无 content-encoding", async () => {
    const r = await vendorResponse("a.js", CT, async () => RAW, {});
    expect(r.status).toBe(200);
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect((r.body as Buffer).equals(RAW)).toBe(true);
  });

  it("If-None-Match 命中 → 304 无 body,仍带 etag", async () => {
    const first = await vendorResponse("a.js", CT, async () => RAW, {});
    const etag = first.headers["etag"];
    const r = await vendorResponse("a.js", CT, async () => RAW, { ifNoneMatch: etag });
    expect(r.status).toBe(304);
    expect(r.body).toBeUndefined();
    expect(r.headers["etag"]).toBe(etag);
    const list = await vendorResponse("a.js", CT, async () => RAW, { ifNoneMatch: '"nope", ' + etag });
    expect(list.status).toBe(304);
  });

  it("If-None-Match 不命中 → 200", async () => {
    const r = await vendorResponse("a.js", CT, async () => RAW, { ifNoneMatch: '"deadbeef"' });
    expect(r.status).toBe(200);
  });

  it("memo:同名第二次不再调 loadRaw;__clearVendorCache 后重调", async () => {
    let calls = 0;
    const load = async () => { calls += 1; return RAW; };
    await vendorResponse("m.js", CT, load, {});
    await vendorResponse("m.js", CT, load, { acceptEncoding: "gzip" });
    expect(calls).toBe(1);
    __clearVendorCache();
    await vendorResponse("m.js", CT, load, {});
    expect(calls).toBe(2);
  });

  it("loadRaw 抛错原样上抛且不污染 memo", async () => {
    await expect(vendorResponse("e.js", CT, async () => { throw new Error("nofile"); }, {})).rejects.toThrow("nofile");
    const ok = await vendorResponse("e.js", CT, async () => RAW, {});
    expect(ok.status).toBe(200);
  });
});