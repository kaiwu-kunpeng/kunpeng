import { test, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertRegistrableRepo } from "../../src/project/registry.js";
import { renderRegisterProject } from "../../src/server/ui/views/register-project.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";

test("存在的目录 → ok", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kp-reg-"));
  try { expect((await assertRegistrableRepo(dir)).ok).toBe(true); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test("空/相对/不存在/非目录 → fail-closed 带 error", async () => {
  expect((await assertRegistrableRepo("")).ok).toBe(false);
  expect((await assertRegistrableRepo("relative/path")).ok).toBe(false);
  expect((await assertRegistrableRepo("/nope/zzz-does-not-exist-123")).ok).toBe(false);
  const dir = await mkdtemp(join(tmpdir(), "kp-reg-"));
  try {
    const f = join(dir, "afile");
    await writeFile(f, "x");
    const r = await assertRegistrableRepo(f);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("视图含表单字段 + render-view 路由", () => {
  const state = {} as unknown as import("../../src/server/state.js").DashboardState;
  const html = renderRegisterProject(state);
  expect(html).toContain("接管新项目");
  expect(html).toContain('data-field="repoPath"');
  expect(html).toContain('data-action="register-project"');
  expect(renderViewFragment(state, "#/register-project")).toBe(renderRegisterProject(state));
});
