import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { collectState } from "../../src/server/state.js";

let parent: string, repo: string;
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "kp-locx-"));
  repo = join(parent, "proj");
  mkdirSync(repo);
});
afterEach(() => rmSync(parent, { recursive: true, force: true }));

test("Next.js 布局(app/ 下的 .tsx)代码行数能显示", async () => {
  mkdirSync(join(repo, "app"), { recursive: true });
  writeFileSync(join(repo, "app", "page.tsx"), "export default function P(){\n  return null;\n}", "utf8"); // 3 行
  mkdirSync(join(repo, "lib"), { recursive: true });
  writeFileSync(join(repo, "lib", "u.ts"), "export const x = 1;", "utf8"); // 1 行
  const st = await collectState(new ArtifactStore(join(repo, ".kunpeng", "artifacts")), repo);
  expect(st.code.srcLines).toBe(4); // app/page.tsx 3 + lib/u.ts 1
});

test("monorepo(orchestrator/src)仍只用 orchestrator 布局,不叠加根目录", async () => {
  mkdirSync(join(repo, "orchestrator", "src"), { recursive: true });
  writeFileSync(join(repo, "orchestrator", "src", "a.ts"), "a\nb\nc", "utf8"); // 3 行
  mkdirSync(join(repo, "app"), { recursive: true });
  writeFileSync(join(repo, "app", "b.tsx"), "1\n2\n3\n4\n5", "utf8"); // 5 行(应被忽略)
  const st = await collectState(new ArtifactStore(join(repo, ".kunpeng", "artifacts")), repo);
  expect(st.code.srcLines).toBe(3);
});