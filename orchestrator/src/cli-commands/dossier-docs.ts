import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { FlowTracker } from "../runtime/flowstate.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { planDossierWrite } from "../dossier/dossier.js";
import { buildSpecIndex, renderSpecIndex } from "../dossier/spec-index.js";
import { nextAdrNumber, adrFilename, renderAdr, supersedeStatus } from "../dossier/adr.js";
import { categorize, addEntry } from "../dossier/changelog.js";
import { bumpSemver, rollUnreleased, readVersionField, writeVersionField, type SemverKind } from "../dossier/release.js";
import { positionalArgs } from "../util/cli-args.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { readRegistry, kunpengStateDir } from "../project/registry.js";
import { compileAll } from "../compile/compile-all.js";
import { compileAgentsMd } from "../compile/agents-md.js";
import { buildMethodologyBundle } from "../compile/methodology-bundle.js";
import { ArtifactStore } from "../artifacts/store.js";
import { compileDocs } from "../compile/docs.js";
import { syncCliIndex } from "../help/cli-reference.js";
import { listCliCommands, registerCliCommand, type CliContext } from "./registry.js";

registerCliCommand({
  name: "dossier",
  run: async (context: CliContext) => {
    const tracker = new FlowTracker(resolveProjectStateDir(context.repoRoot));
    const flows = await tracker.list();
    const input = {
      projectName: context.repoRoot.split("/").filter(Boolean).pop() ?? "project",
      flows: flows.map((s) => ({ flowId: s.flowId, status: s.status, stage: s.stage, updatedAt: s.updatedAt })),
      now: Date.now(),
    };
    const path = join(context.repoRoot, "PROJECT.md");
    const existing = await readFile(path, "utf8").catch(() => null);
    const plan = planDossierWrite(existing, input);
    if (!plan.write) {
      console.error(`[dossier] 拒绝覆盖 PROJECT.md：${plan.reason}`);
      process.exitCode = 1;
      return;
    }
    await writeFileAtomic(path, plan.next);
    console.log(`[dossier] 已刷新 ${path}（${input.flows.length} 流，机器区已更新${existing ? "，人写区保留" : "，新建骨架"}）`);
    return;
  },
});

registerCliCommand({
  name: "spec-index",
  run: async (context: CliContext) => {
    const dir = join(context.repoRoot, "docs", "specs");
    const files = (await readdir(dir).catch((): string[] => [])).filter((f) => f.endsWith(".md"));
    const specs = await Promise.all(
      files.map(async (f) => ({ filename: f, content: await readFile(join(dir, f), "utf8").catch(() => "") })),
    );
    const entries = buildSpecIndex(specs);
    const out = join(context.repoRoot, "docs", "spec-index.md");
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, renderSpecIndex(entries), "utf8");
    console.log(`[spec-index] ${entries.length} 份 spec（活跃 ${entries.filter((e) => !e.superseded).length}）→ ${out}`);
    return;
  },
});

registerCliCommand({
  name: "adr",
  run: async (context: CliContext) => {
    const title = positionalArgs(context.rest, ["--status", "--supersedes"]).join(" ");
    if (!title) {
      console.error('用法: kunpeng adr "<决策标题>" [--status accepted] [--supersedes NNNN]');
      process.exit(1);
    }
    const statusIdx = context.rest.indexOf("--status");
    const status = statusIdx >= 0 ? context.rest[statusIdx + 1] : "Proposed";
    const supIdx = context.rest.indexOf("--supersedes");
    const supersedes = supIdx >= 0 ? context.rest[supIdx + 1] : undefined;
    const dir = join(context.repoRoot, "docs", "decisions");
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir).catch((): string[] => []);
    const num = nextAdrNumber(files);
    const dateISO = new Date().toISOString().slice(0, 10);
    const fname = adrFilename(num, title);
    await writeFile(join(dir, fname), renderAdr(num, title, { status, supersedes, dateISO }), "utf8");
    if (supersedes) {
      const oldFile = files.find((f) => f.startsWith(`${supersedes}-`));
      if (oldFile) {
        const oldPath = join(dir, oldFile);
        await writeFile(oldPath, supersedeStatus(await readFile(oldPath, "utf8"), num), "utf8");
      }
    }
    console.log(`[adr] 已建 ADR-${num} → ${join(dir, fname)}${supersedes ? `（取代 ADR-${supersedes}）` : ""}`);
    return;
  },
});

registerCliCommand({
  name: "changelog",
  run: async (context: CliContext) => {
    const pos = positionalArgs(context.rest, ["--type"]);
    const sub = pos[0];
    if (sub !== "add") {
      console.error('用法: kunpeng changelog add "<条目>" [--type feat|fix|...]');
      process.exit(1);
    }
    const entry = pos.slice(1).join(" ");
    if (!entry) {
      console.error('用法: kunpeng changelog add "<条目>" [--type feat]');
      process.exit(1);
    }
    const typeIdx = context.rest.indexOf("--type");
    const category = categorize(typeIdx >= 0 ? context.rest[typeIdx + 1] ?? "" : "");
    const path = join(context.repoRoot, "CHANGELOG.md");
    const existing = await readFile(path, "utf8").catch(() => null);
    await writeFile(path, addEntry(existing, category, entry), "utf8");
    console.log(`[changelog] 已追加到 Unreleased/${category}：${entry}`);
    return;
  },
});

registerCliCommand({
  name: "bump",
  run: async (context: CliContext) => {
    const kind = context.rest[0];
    if (kind !== "major" && kind !== "minor" && kind !== "patch") {
      console.error("用法: kunpeng bump <major|minor|patch> [--repo <仓库>]");
      process.exit(1);
    }
    let pkgPath = join(context.repoRoot, "package.json");
    let pkgText: string;
    try {
      pkgText = await readFile(pkgPath, "utf8");
    } catch {
      pkgPath = join(context.repoRoot, "orchestrator", "package.json");
      pkgText = await readFile(pkgPath, "utf8").catch(() => { throw new Error("找不到 package.json"); });
    }
    const cur = readVersionField(pkgText);
    const next = bumpSemver(cur, kind as SemverKind);
    await writeFile(pkgPath, writeVersionField(pkgText, next), "utf8");
    const clPath = join(context.repoRoot, "CHANGELOG.md");
    const cl = await readFile(clPath, "utf8").catch(() => null);
    if (cl) {
      await writeFile(clPath, rollUnreleased(cl, next, new Date().toISOString().slice(0, 10)), "utf8");
    }
    console.log(`[version] ${cur} -> ${next}（package.json 已升${cl ? "、CHANGELOG Unreleased 已滚成版本节" : "；无 CHANGELOG.md，跳过"}）`);
    console.log(`  下一步(手动)：git add -p && git commit -m "chore(release): v${next}" && git tag v${next}`);
    return;
  },
});

registerCliCommand({
  name: "compile",
  run: async (context: CliContext) => {
    // --all：遍历中央注册表，把宪法一次编译到所有已注册项目（跨项目传播：新约定当天到达每个项目）。
    if (context.flags.has("--all")) {
      const projects = await readRegistry(kunpengStateDir());
      const items = await compileAll(context.kunpengHome, projects);
      for (const it of items) {
        if (it.error) console.log(`  ✗ ${it.id}（${it.repoPath}）：${it.error}`);
        else console.log(`  ✓ ${it.id} → ${it.path}${it.clobberAvoided ? "（未覆盖其自有 AGENTS.md）" : ""}`);
      }
      const ok = items.filter((i) => !i.error).length;
      console.log(`[compile --all] ${ok}/${items.length} 个项目已同步宪法（源自鲲鹏 HOME ${context.kunpengHome}）`);
      return;
    }
    // 把鲲鹏的宪法 stamp 进【目标仓库】——非覆盖：目标已有自己的 AGENTS.md 时改写到 .kunpeng/。
    const res = await compileAgentsMd({ kunpengRoot: context.kunpengHome, outFile: join(context.repoRoot, "AGENTS.md") });
    console.log(res.clobberAvoided
      ? `目标已有自己的 AGENTS.md（未覆盖）→ 鲲鹏规矩写到 ${res.path}`
      : `AGENTS.md 已写入 → ${res.path}（源自鲲鹏 HOME ${context.kunpengHome}）`);
    return;
  },
});

registerCliCommand({
  name: "asset-bundle",
  run: async (context: CliContext) => {
    // 把鲲鹏工程方法论(宪法+约定+skills)打成脱底座可携带资产包。
    // outDir 可选,默认落 <repoRoot>/.kunpeng/methodology-bundle。
    const outDir = context.rest[0] ? resolve(context.rest[0]) : join(context.repoRoot, ".kunpeng", "methodology-bundle");
    const res = await buildMethodologyBundle({ kunpengRoot: context.kunpengHome, outDir });
    console.log(`方法论资产包已生成 → ${res.outDir}（${res.files.length} 个文件：${res.files.join(", ")}）`);
    console.log(`脱底座可携带：把该目录丢进任何平台 agent(Claude Code/Codex/Cursor)即可复用鲲鹏工程纪律。`);
    return;
  },
});

registerCliCommand({
  name: "doc",
  run: async (context: CliContext) => {
    if (context.rest[0] === "cli-reference") {
      const path = join(context.repoRoot, "docs/help/02-user-guide/cli-reference.md");
      const doc = await readFile(path, "utf8");
      await writeFile(path, syncCliIndex(doc, listCliCommands().map((command) => command.name)), "utf8");
      console.log(`[文档治理] CLI 命令索引已更新 → ${path}`);
      return;
    }
    const store = new ArtifactStore(join(context.repoRoot, ".kunpeng", "artifacts"));
    const out = join(context.repoRoot, ".kunpeng", "DOCS.md");
    await compileDocs(store, out);
    console.log(`[文档治理] 文档索引已生成 → ${out}`);
    return;
  },
});
