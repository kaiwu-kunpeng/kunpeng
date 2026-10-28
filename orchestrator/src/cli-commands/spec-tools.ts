import * as fs from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runCodegraphIndex } from "../codegraph/index-cmd.js";
import { runCodegraphServe } from "../codegraph/serve-cmd.js";
import { runCodegraphSavings } from "../codegraph/savings-cmd.js";
import { formatLintReport, lintSpecText } from "../plan/spec-lint.js";
import { runAiRepoKit } from "../dossier/ai-repo-kit-cmd.js";
import { runSpecDelta } from "../spec/spec-delta-cmd.js";
import { importExternalSpec, type ExternalSpecFormat } from "../spec/import-external.js";
import { releaseArtifactFrom, runBuildRelease } from "../loop/build-release.js";
import { ArtifactStore } from "../artifacts/store.js";
import { registerCliCommand, type CliContext } from "./registry.js";

const SPEC_LINT_USAGE = "用法: kunpeng spec-lint <spec.md> [--strict] [--repo <仓库>]";

registerCliCommand({
  name: "codegraph",
  run: async (context: CliContext) => {
    if (context.rest[0] === "serve") {
      await runCodegraphServe(context.repoRoot);
      return;
    }
    if (context.rest[0] === "savings") {
      const query = context.rest[1];
      if (query === undefined) {
        console.error("用法: kunpeng codegraph savings <查询词> [--repo <仓库>]");
        process.exit(1);
      }
      runCodegraphSavings(context.repoRoot, query);
      return;
    }
    if (context.rest[0] !== "index") {
      console.error("用法: kunpeng codegraph <index|serve|savings> [--repo <仓库>]");
      process.exit(1);
    }
    const stats = await runCodegraphIndex(context.repoRoot);
    console.log(`[codegraph] 索引 ${stats.nodes} 节点/${stats.edges} 边`);
    return;
  },
});

registerCliCommand({
  name: "spec-lint",
  usage: SPEC_LINT_USAGE,
  run: async (context: CliContext) => {
    const specPath = context.rest[0];
    if (!specPath) {
      console.error(SPEC_LINT_USAGE);
      process.exit(1);
    }
    const issues = lintSpecText(await readFile(resolve(specPath), "utf8"), context.repoRoot);
    console.log(formatLintReport(issues));
    const failed = issues.some((item) => item.level === "error")
      || (context.flags.has("--strict") && issues.some((item) => item.level === "warn"));
    process.exit(failed ? 1 : 0);
  },
});

registerCliCommand({
  name: "ai-repo-kit",
  run: async (context: CliContext) => {
    const projectName = context.rest[0];
    const outDir = context.rest[1];
    if (!projectName || !outDir) {
      console.error("用法: kunpeng ai-repo-kit <projectName> <outDir>");
      process.exit(1);
    }
    process.exit(await runAiRepoKit({ projectName }, outDir, fs.promises));
  },
});

registerCliCommand({
  name: "spec-delta",
  run: async (context: CliContext) => {
    const basePath = context.rest[0];
    const nextPath = context.rest[1];
    if (!basePath || !nextPath) {
      console.error("用法: kunpeng spec-delta <base.md> <next.md>");
      process.exit(1);
    }
    process.exit(runSpecDelta(basePath, nextPath, { readFile: (path) => fs.readFileSync(path, "utf8") }));
  },
});

registerCliCommand({
  name: "spec-import",
  run: async (context: CliContext) => {
    const usage = "用法: kunpeng spec-import --from <spec-kit|openspec> <输入目录> --out <输出.md>";
    const fromAt = context.rest.indexOf("--from");
    const format = fromAt >= 0 ? context.rest[fromAt + 1] : undefined;
    const dir = context.rest.filter((_, i) => i !== fromAt && i !== fromAt + 1)[0];
    if ((format !== "spec-kit" && format !== "openspec") || !dir || !context.outArg) {
      console.error(usage);
      process.exit(1);
    }
    const out = resolve(context.outArg);
    if (fs.existsSync(out)) {
      console.error(`输出文件已存在，不覆盖：${out}`);
      process.exit(1);
    }
    fs.writeFileSync(out, importExternalSpec(format as ExternalSpecFormat, resolve(dir)), "utf8");
    console.log(`[spec-import] 已写 ${out}（导入件不带 scope 与验收，补齐前派流前闸会拦下）`);
  },
});

registerCliCommand({
  name: "release",
  run: async (context: CliContext) => {
    const buildCmd = context.rest.join(" ");
    if (!buildCmd) { console.error('用法: kunpeng release "<build command>"'); process.exit(1); }
    const version = `v${Date.now().toString(36)}`;
    const r = await runBuildRelease(context.repoRoot, buildCmd, version);
    const store = new ArtifactStore(join(context.repoRoot, ".kunpeng", "artifacts"));
    await store.write(releaseArtifactFrom(r, version, buildCmd));
    console.log(`[构建发布] ${r.released ? "✅ 构建就绪 · 待在 Review Inbox 确认发布" : "❌ 构建失败"} version=${version}`);
    if (!r.released) console.log(r.output);
    process.exit(r.released ? 0 : 2);
  },
});
