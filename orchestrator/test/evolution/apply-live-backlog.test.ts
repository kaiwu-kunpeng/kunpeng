import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { runApplyApprovedLive } from "../../src/evolution/apply-live.js";
import { ReinjectStore } from "../../src/feedback/reinject-store.js";

let dir: string;
let store: ArtifactStore;
let conventionsPath: string;
let log: import("vitest").MockInstance<(...args: unknown[]) => void>;
let prevState: string | undefined;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kp-apply-live-backlog-"));
  // 隔离注册表：即使走到 compileAll 也只看空注册表，绝不碰真实项目的 AGENTS.md。
  prevState = process.env.KUNPENG_STATE;
  process.env.KUNPENG_STATE = join(dir, "state");
  await mkdir(join(dir, ".kunpeng", "artifacts"), { recursive: true });
  await mkdir(join(dir, "constitution"), { recursive: true });
  conventionsPath = join(dir, "constitution", "conventions.md");
  await writeFile(conventionsPath, "# 可调约定\n- 已有约定\n", "utf8");
  store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  if (prevState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = prevState;
  log.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

async function seedApproved(id: string, texts: string[]): Promise<void> {
  await store.write({
    kind: "proposal", id, status: "approved", body: `# ${id}`,
    meta: { proposal: { changes: texts.map((text, i) => ({ target: "conventions", text, source: `exp-${i}` })) } },
  });
}

test("默认（非 --live）：约定提案不直写宿主约定文件，而是生成一条 backlog 需求；提案转 in-progress 并记 landing", async () => {
  await seedApproved("p-conv", ["新约定 A", "新约定 B"]);

  await runApplyApprovedLive(dir, dir);

  expect(await readFile(conventionsPath, "utf8")).toBe("# 可调约定\n- 已有约定\n");
  const pending = await new ReinjectStore(join(dir, ".kunpeng", "feedback")).pending();
  expect(pending).toHaveLength(1);
  expect(pending[0]!.source).toBe("proposal:conventions");
  expect(pending[0]!.requirement).toContain("- 新约定 A");
  expect(pending[0]!.requirement).toContain("- 新约定 B");
  expect(pending[0]!.requirement).toContain("constitution/conventions.md");

  const p = await store.read("p-conv");
  expect(p.status).toBe("in-progress");
  const landing = p.meta.landing as { channel?: string; fingerprint?: string; enqueuedAt?: string };
  expect(landing.channel).toBe("backlog");
  expect(landing.fingerprint).toBe(pending[0]!.fingerprint);
  expect(typeof landing.enqueuedAt).toBe("string");
  const lines = log.mock.calls.map((c) => String(c[0]));
  expect(lines.some((l) => l.includes("p-conv") && l.includes("backlog"))).toBe(true);
  expect(lines.some((l) => l.includes("跨项目传播"))).toBe(false);
});

test("默认：内容相同的两条 approved 提案只生成一条 backlog 需求，两条都转 in-progress", async () => {
  await seedApproved("p-one", ["同一条约定"]);
  await seedApproved("p-two", ["同一条约定"]);

  await runApplyApprovedLive(dir, dir);

  expect(await new ReinjectStore(join(dir, ".kunpeng", "feedback")).pending()).toHaveLength(1);
  expect((await store.read("p-one")).status).toBe("in-progress");
  expect((await store.read("p-two")).status).toBe("in-progress");
});

test("落地确认：in-progress 且 landing=backlog 的提案，约定文件已含全部条目 → 转 verified；未含则保持", async () => {
  await store.write({
    kind: "proposal", id: "p-landed", status: "in-progress", body: "# p-landed",
    meta: { landing: { channel: "backlog", fingerprint: "deadbeef", enqueuedAt: "2026-09-01T00:00:00.000Z" }, proposal: { changes: [{ target: "conventions", text: "已有约定", source: "exp-0" }] } },
  });
  await store.write({
    kind: "proposal", id: "p-waiting", status: "in-progress", body: "# p-waiting",
    meta: { landing: { channel: "backlog", fingerprint: "cafebabe", enqueuedAt: "2026-09-01T00:00:00.000Z" }, proposal: { changes: [{ target: "conventions", text: "还没落地的约定", source: "exp-0" }] } },
  });
  await store.write({
    kind: "proposal", id: "p-other", status: "in-progress", body: "# p-other",
    meta: { proposal: { changes: [{ target: "conventions", text: "已有约定", source: "exp-0" }] } },
  });

  await runApplyApprovedLive(dir, dir);

  expect((await store.read("p-landed")).status).toBe("verified");
  expect((await store.read("p-waiting")).status).toBe("in-progress");
  expect((await store.read("p-other")).status).toBe("in-progress");
  expect(log.mock.calls.map((c) => String(c[0])).some((l) => l.includes("p-landed") && l.includes("verified"))).toBe(true);
});

test("--live：保留旧直写路径（约定文件被追加），且不入 backlog", async () => {
  await seedApproved("p-live", ["直写的约定"]);
  await runApplyApprovedLive(dir, dir, { live: true, propagate: async () => [] });
  expect(await readFile(conventionsPath, "utf8")).toContain("- 直写的约定");
  expect(await new ReinjectStore(join(dir, ".kunpeng", "feedback")).pending()).toHaveLength(0);
  expect((await store.read("p-live")).status).toBe("verified");
});