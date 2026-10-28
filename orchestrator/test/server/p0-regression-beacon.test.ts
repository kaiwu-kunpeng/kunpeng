import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { serveBeaconIngest } from "../../src/server/beacon-static.js";
import { beaconSecret, beaconToken } from "../../src/product/beacon-token.js";

let repo: string;
let stateDir: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-p0-beacon-repo-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-p0-beacon-state-"));
  mkdirSync(join(repo, ".kunpeng", "product", "demo"), { recursive: true });
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); rmSync(stateDir, { recursive: true, force: true }); });

async function post(body: Record<string, unknown>): Promise<number> {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  let status = 200;
  const res = { setHeader() {}, end() {}, get statusCode() { return status; }, set statusCode(v: number) { status = v; } } as unknown as ServerResponse;
  await serveBeaconIngest({ repoRoot: repo, stateDir }, "POST", "/api/beacon", req, res);
  return status;
}

function findPicks(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name);
      if (name.isDirectory()) walk(p); else if (name.name === "picks.jsonl") out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe("P0-1 回归锁：beacon 必须带 token，slug 不能穿越（作者锁定）", () => {
  it("无 token → 401 且不写盘", async () => {
    expect(await post({ kind: "pick", slug: "demo", selector: "h1" })).toBe(401);
    expect(findPicks(repo)).toEqual([]);
  });

  it("有 token 但 slug 是 ../ 穿越 → 不写任何 picks.jsonl", async () => {
    const secret = await beaconSecret(stateDir);
    const slug = "../../escape";
    mkdirSync(join(repo, "escape"), { recursive: true });
    const status = await post({ kind: "pick", slug, t: beaconToken(slug, secret), selector: "h1", text: "x" });
    expect([204, 400, 401]).toContain(status);
    expect(findPicks(repo)).toEqual([]);
    expect(existsSync(join(repo, "picks.jsonl"))).toBe(false);
  });

  it("正向对照：合法 slug + 正确 token → 写进 .kunpeng/product/demo/picks.jsonl", async () => {
    const secret = await beaconSecret(stateDir);
    expect(await post({ kind: "pick", slug: "demo", t: beaconToken("demo", secret), selector: "h1", text: "标题" })).toBe(204);
    const file = join(repo, ".kunpeng", "product", "demo", "picks.jsonl");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain('"selector":"h1"');
    expect(findPicks(repo)).toEqual([file]);
  });

  it("错误 token → 401", async () => {
    expect(await post({ kind: "pick", slug: "demo", t: "bogus", selector: "h1" })).toBe(401);
  });
});