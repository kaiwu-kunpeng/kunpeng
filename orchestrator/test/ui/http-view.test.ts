import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { startDashboard } from "../../src/server/http.js";

let repo: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-http-view-"));
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t").addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "# test\n");
  await git.add("README.md");
  await git.commit("init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("/api/view returns server-rendered view fragments", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const inbox = await fetch(`http://127.0.0.1:${srv.port}/api/view?route=%23/inbox`);
    const inboxHtml = await inbox.text();
    expect(inbox.status).toBe(200);
    expect(inbox.headers.get("content-type")).toMatch(/^text\/html/);
    // 判别性断言：inbox 独有「控制门」+ 不含 overview 独有「在跑什么」（否则端点忽略 route 返 overview 也会绿）。
    expect(inboxHtml).toContain("控制门");
    expect(inboxHtml).not.toContain("在跑什么");

    const overview = await fetch(`http://127.0.0.1:${srv.port}/api/view?route=%23/overview`);
    const overviewHtml = await overview.text();
    expect(overview.status).toBe(200);
    expect(overview.headers.get("content-type")).toMatch(/^text\/html/);
    expect(overviewHtml).toContain("在跑什么");
    expect(overviewHtml).not.toContain("控制门");
  } finally {
    srv.close();
  }
});
