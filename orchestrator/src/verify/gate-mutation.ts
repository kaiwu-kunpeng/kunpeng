import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { HARNESS_GATE_FILES } from "../runtime/harness-stamp.js";
import { sensitiveHitsForBranch } from "../runtime/sensitive-branch.js";
import { classifySensitiveFiles } from "../runtime/sensitive-paths.js";
import { parseEvaluatorVerdict } from "./evaluator.js";
import { newFailures, runVerification } from "./gate.js";

export interface GateMutation {
  id: string;
  gate: "verification" | "new-failures" | "sensitive" | "evaluator" | "sensitive-branch";
  /** true 表示被门拦下，false 表示漏网。 */
  run: () => Promise<boolean>;
}

const execFileAsync = promisify(execFile);

export const GATE_MUTATIONS: readonly GateMutation[] = [
  ...[
    ["verification:false", "false"],
    ["verification:and-chain", "false && echo ok"],
    ["verification:exit-1", "exit 1"],
    ["verification:nonfinal-line", "false\necho ok"],
    ["verification:pipe-mask", "false | true"],
    ["verification:semicolon-mask", "test -f /nonexistent-kp-mutation; echo done"],
  ].map<GateMutation>(([id, cmd]) => ({
    id,
    gate: "verification",
    run: async () => (await runVerification({ cwd: tmpdir(), cmd, timeoutMs: 10_000, strict: true })).passed === false,
  })),
  ...[
    ["new-failures:vitest-fail", " FAIL  test/x.test.ts > a"],
    ["new-failures:assertion", "AssertionError: expected 1 to be 2"],
    ["new-failures:tsc", "src/a.ts(1,1): error TS2322: bad"],
    ["new-failures:cross", " × test/x.test.ts > b"],
  ].map<GateMutation>(([id, line]) => ({
    id,
    gate: "new-failures",
    run: async () => newFailures("", line).length > 0,
  })),
  ...[
    ...HARNESS_GATE_FILES.map((path) => `orchestrator/${path}`),
    "orchestrator/src/verify/evaluator.ts",
    "orchestrator/src/verify/diff-confirm.ts",
    "orchestrator/src/plan/orchestrator.ts",
    "orchestrator/src/runtime/harness-stamp.ts",
    "orchestrator/src/verify/gate-mutation.ts",
    "orchestrator/src/verify/gate-survivors.json",
    "orchestrator/test/verify/gate-mutation.accept.test.ts",
    "orchestrator/vitest.config.ts",
    "orchestrator/tsconfig.test.json",
    "orchestrator/package.json",
    "deploy/scripts/sync-mirror.sh",
    "orchestrator/.npmrc",
    ".npmrc",
    "orchestrator/tsconfig.json",
    "orchestrator/test/vitest-setup.ts",
    "orchestrator/test/helpers/fixture.ts",
    "orchestrator/src/runtime/sensitive-content.ts",
  ].map<GateMutation>((path) => ({
    id: `sensitive:${path}`,
    gate: "sensitive",
    run: async () => classifySensitiveFiles([path]).sensitive,
  })),
  ...[
    ["evaluator:prose", "我觉得通过了"],
    ["evaluator:upper", '{"verdict":"PASS","reason":"x"}'],
    ["evaluator:bare-word", ["`".repeat(3), "pass", "`".repeat(3)].join("\n")],
  ].map<GateMutation>(([id, text]) => ({
    id,
    gate: "evaluator",
    run: async () => parseEvaluatorVerdict(text).verdict !== "pass",
  })),
  {
    id: "sensitive-branch:rename-away",
    gate: "sensitive-branch",
    run: async () => {
      const repo = await mkdtemp(join(tmpdir(), "kp-rename-away-"));
      try {
        const git = (...args: string[]) => execFileAsync("git", args, {
          cwd: repo,
          timeout: 10_000,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "gate-mutation",
            GIT_AUTHOR_EMAIL: "gate-mutation@example.com",
            GIT_COMMITTER_NAME: "gate-mutation",
            GIT_COMMITTER_EMAIL: "gate-mutation@example.com",
          },
        });
        const source = "orchestrator/src/runtime/sensitive-paths.ts";
        await git("init", "-q", "-b", "main");
        await mkdir(join(repo, "orchestrator/src/runtime"), { recursive: true });
        await writeFile(join(repo, source), "export const same = 1;\n".repeat(30));
        await git("add", source);
        await git("commit", "-qm", "base");
        await git("checkout", "-qb", "kp/rename-away");
        await git("mv", source, "orchestrator/src/runtime/paths-x.ts");
        await git("commit", "-qm", "rename away");
        await git("checkout", "-q", "main");
        return (await sensitiveHitsForBranch(repo, "rename-away", "main")).length > 0;
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    id: "sensitive-branch:weaken-test",
    gate: "sensitive-branch",
    run: async () => {
      const repo = await mkdtemp(join(tmpdir(), "kp-weaken-test-"));
      try {
        const git = (...args: string[]) => execFileAsync("git", args, {
          cwd: repo,
          timeout: 10_000,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "gate-mutation",
            GIT_AUTHOR_EMAIL: "gate-mutation@example.com",
            GIT_COMMITTER_NAME: "gate-mutation",
            GIT_COMMITTER_EMAIL: "gate-mutation@example.com",
          },
        });
        const source = "orchestrator/test/x.test.ts";
        await git("init", "-q", "-b", "main");
        await mkdir(join(repo, "orchestrator/test"), { recursive: true });
        await writeFile(join(repo, source), 'it("a", () => {});\nit("b", () => {});\n');
        await git("add", source);
        await git("commit", "-qm", "base");
        await git("checkout", "-qb", "kp/weaken-test");
        await writeFile(join(repo, source), 'it("a", () => {});\n');
        await git("commit", "-qam", "weaken test");
        await git("checkout", "-q", "main");
        return (await sensitiveHitsForBranch(repo, "weaken-test", "main")).length > 0;
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    id: "sensitive-branch:weaken-node-test",
    gate: "sensitive-branch",
    run: async () => {
      const repo = await mkdtemp(join(tmpdir(), "kp-weaken-node-test-"));
      try {
        const git = (...args: string[]) => execFileAsync("git", args, {
          cwd: repo,
          timeout: 10_000,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "gate-mutation",
            GIT_AUTHOR_EMAIL: "gate-mutation@example.com",
            GIT_COMMITTER_NAME: "gate-mutation",
            GIT_COMMITTER_EMAIL: "gate-mutation@example.com",
          },
        });
        const source = "tests/spec-accept/x.accept.mjs";
        await git("init", "-q", "-b", "main");
        await mkdir(join(repo, "tests/spec-accept"), { recursive: true });
        await writeFile(join(repo, source), 'test("a", () => { assert.ok(1); assert.equal(1, 1); });\n');
        await git("add", source);
        await git("commit", "-qm", "base");
        await git("checkout", "-qb", "kp/weaken-node-test");
        await writeFile(join(repo, source), 'test("a", () => { assert.ok(1); });\n');
        await git("commit", "-qam", "weaken node test");
        await git("checkout", "-q", "main");
        return (await sensitiveHitsForBranch(repo, "weaken-node-test", "main")).length > 0;
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    id: "sensitive-branch:scripts-change",
    gate: "sensitive-branch",
    run: async () => {
      const repo = await mkdtemp(join(tmpdir(), "kp-scripts-change-"));
      try {
        const git = (...args: string[]) => execFileAsync("git", args, {
          cwd: repo,
          timeout: 10_000,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "gate-mutation",
            GIT_AUTHOR_EMAIL: "gate-mutation@example.com",
            GIT_COMMITTER_NAME: "gate-mutation",
            GIT_COMMITTER_EMAIL: "gate-mutation@example.com",
          },
        });
        const source = "orchestrator/package.json";
        await git("init", "-q", "-b", "main");
        await mkdir(join(repo, "orchestrator"), { recursive: true });
        await writeFile(join(repo, source), JSON.stringify({ scripts: { test: "vitest run" } }));
        await git("add", source);
        await git("commit", "-qm", "base");
        await git("checkout", "-qb", "kp/scripts-change");
        await writeFile(join(repo, source), JSON.stringify({ scripts: { test: "echo ok" } }));
        await git("commit", "-qam", "change scripts");
        await git("checkout", "-q", "main");
        return (await sensitiveHitsForBranch(repo, "scripts-change", "main")).length > 0;
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

export async function runGateMutations(): Promise<{ id: string; caught: boolean }[]> {
  const results: { id: string; caught: boolean }[] = [];
  for (const mutation of GATE_MUTATIONS) {
    let caught = false;
    try {
      caught = await mutation.run();
    } catch {
      // 执行异常不能当作成功拦截；记为漏网，继续测量其余样本。
    }
    results.push({ id: mutation.id, caught });
  }
  return results;
}
