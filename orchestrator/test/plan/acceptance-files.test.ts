import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import type { AgentRequest, AgentRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle, extractAuthorFilesFromSpec } from "../../src/loop/dev-cycle.js";

let repo: string;
let store: ArtifactStore;
let ws: Workspace;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-acceptance-files-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "base\n");
  await g.add(".");
  await g.commit("init");
  store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  ws = new Workspace(repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

test("extracts author-owned files from spec metadata and fences", () => {
  const specText = `# spec

\`\`\`file tests/from-fence.txt
FENCE
\`\`\`

<file path="tests/from-tag.txt">
TAG
</file>
`;

  expect(extractAuthorFilesFromSpec(specText, {
    authorFiles: [{ path: "tests/from-meta.txt", content: "META" }],
  })).toEqual([
    { path: "tests/from-meta.txt", content: "META" },
    { path: "tests/from-fence.txt", content: "FENCE" },
    { path: "tests/from-tag.txt", content: "TAG" },
  ]);
});

test("forces spec-authored acceptance files onto disk immediately before verification", async () => {
  const specText = `# spec

The author-owned acceptance file must be restored immediately before verify.

\`\`\`file tests/author-acceptance.txt
AUTHOR TEST
\`\`\`
`;
  const acceptanceCmd = "node -e \"const fs=require('fs'); const s=fs.readFileSync('tests/author-acceptance.txt','utf8'); if(!s.includes('AUTHOR TEST')) process.exit(1); if(s.includes('tampered')) process.exit(1);\"";
  const runner: AgentRunner = {
    async run(req: AgentRequest) {
      if (req.stage === "spec") return { text: specText, meta: { testCmd: acceptanceCmd } };
      if (!req.cwd) throw new Error("missing cwd");
      mkdirSync(join(req.cwd, "tests"), { recursive: true });
      writeFileSync(join(req.cwd, "tests", "author-acceptance.txt"), "tampered by implementer\n");
      return { text: "tampered", meta: {} };
    },
  };
  const dc = new DevCycle({ store, ws, runner, flowId: "author-files" });

  const result = await dc.run("author file must govern verification");

  expect(result.status).toBe("verified");
  const committed = await simpleGit(repo).show(["kp/author-files:tests/author-acceptance.txt"]);
  expect(committed).toBe("AUTHOR TEST");
});
