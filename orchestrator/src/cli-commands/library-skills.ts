import { execFileSync } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { positionalArgs } from "../util/cli-args.js";
import { buildLibraryIndex, searchLibrary } from "../library/scan.js";
import type { LibraryEntry, LibraryEntryStatus, LibraryEntryType } from "../library/entry.js";
import { setEntryMeta, type LibraryEntryMeta } from "../library/meta.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { appendLesson, listLessons } from "../knowledge/lesson-store.js";
import { findSessionFiles, harvestSessions } from "../knowledge/session-harvest.js";
import { distillFailureLessons } from "../knowledge/lesson-distill.js";
import { applyMerges, planConsolidation } from "../knowledge/lesson-consolidate.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { ArtifactStore } from "../artifacts/store.js";
import { distillSkillToFile } from "../knowledge/distill-skill.js";
import { slugify } from "../project/registry.js";
import { persistProposal } from "../loop/self-evolution.js";
import {
  SKILL_CATEGORIES,
  listSkills,
  registerSkill,
  removeSkill,
  searchSkills,
  setSkillFields,
  skillsRoot,
  type SkillCategory,
  type SkillFieldPatch,
  type SkillLifecycle,
} from "../skills/registry.js";
import { categorizeAll } from "../skills/auto-categorize.js";
import { skillEntryFromDir, validateSkillMd } from "../skills/skill-md.js";
import { packSkills } from "../skills/skill-pack.js";
import { importSkills, scanSkillDirs } from "../skills/import-external.js";
import { registerCliCommand, type CliContext } from "./registry.js";

registerCliCommand({
  name: "lib",
  run: async (context: CliContext) => {
    const usage = "用法: kunpeng lib <scan|ls|search|verify|set|review> [参数]";
    const stateDir = join(context.repoRoot, ".kunpeng");
    const options = {
      specsDir: process.env.KP_LIBRARY_SPECS_DIR || join(homedir(), "kunpeng-specs"),
      docsDir: process.env.KP_LIBRARY_DOCS_DIR || join(homedir(), "kunpeng-strategy-docs"),
      skillsRoot: skillsRoot(process.env),
      stateDir,
    };
    const readIndex = async (): Promise<LibraryEntry[]> => {
      const path = join(stateDir, "library", "index.json");
      try {
        return JSON.parse(await readFile(path, "utf8")) as LibraryEntry[];
      } catch (error) {
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
        return (await buildLibraryIndex(options)).entries;
      }
    };
    const print = (entries: LibraryEntry[]): void => {
      for (const item of entries) console.log(`${item.type}\t${item.status}\t${item.title}\t${item.sourcePath}`);
    };
    if (context.rest[0] === "scan" && context.rest.length === 1) {
      console.log((await buildLibraryIndex(options)).entries.length);
      return;
    }
    if (context.rest[0] === "ls") {
      const args = context.rest.slice(1);
      const typeIndex = args.indexOf("--type");
      const statusIndex = args.indexOf("--status");
      const type = typeIndex >= 0 ? args[typeIndex + 1] : undefined;
      const status = statusIndex >= 0 ? args[statusIndex + 1] : undefined;
      const types = new Set<LibraryEntryType>(["spec", "doc", "capture", "skill"]);
      const statuses = new Set<LibraryEntryStatus>(["draft", "active", "archived"]);
      if (positionalArgs(args, ["--type", "--status"]).length > 0
        || (typeIndex >= 0 && !types.has(type as LibraryEntryType))
        || (statusIndex >= 0 && !statuses.has(status as LibraryEntryStatus))) {
        console.error(usage);
        process.exit(1);
      }
      print(searchLibrary(await readIndex(), "", {
        ...(type ? { type: type as LibraryEntryType } : {}),
        ...(status ? { status: status as LibraryEntryStatus } : {}),
      }));
      return;
    }
    if (context.rest[0] === "search" && context.rest.slice(1).length > 0) {
      print(searchLibrary(await readIndex(), context.rest.slice(1).join(" ")));
      return;
    }
    if (context.rest[0] === "verify") {
      const id = context.rest[1] ?? "";
      const daysIndex = context.rest.indexOf("--days", 2);
      const daysRaw = daysIndex >= 0 ? context.rest[daysIndex + 1] : undefined;
      const days = daysRaw === undefined ? Number.NaN : Number(daysRaw);
      if (context.rest.length !== 4 || daysIndex !== 2 || !id?.trim() || !/^\d+$/.test(daysRaw ?? "") || !Number.isSafeInteger(days)) {
        console.error(usage);
        process.exit(1);
      }
      if (!(await readIndex()).some((item) => item.id === id)) {
        console.error(`未知资料条目: ${id}`);
        process.exit(1);
      }
      await setEntryMeta(stateDir, id, { status: "active", verifyUntil: Date.now() + days * 86_400_000 });
      await buildLibraryIndex(options);
      return;
    }
    if (context.rest[0] === "set") {
      const id = context.rest[1] ?? "";
      const patch: LibraryEntryMeta = {};
      let valid = Boolean(id?.trim());
      for (let i = 2; valid && i < context.rest.length; i += 2) {
        const flag = context.rest[i];
        const value = context.rest[i + 1];
        if (value === undefined || value.startsWith("--")) {
          valid = false;
        } else if (flag === "--audience" && (value === "human" || value === "agent")) {
          patch.audience = value;
        } else if (flag === "--trigger" && value.trim() !== "") {
          patch.trigger = value;
        } else if (flag === "--status" && (["draft", "active", "archived"] as string[]).includes(value)) {
          patch.status = value as LibraryEntryStatus;
        } else {
          valid = false;
        }
      }
      if (!valid || context.rest.length < 4 || Object.keys(patch).length === 0) {
        console.error(usage);
        process.exit(1);
      }
      if (!(await readIndex()).some((item) => item.id === id)) {
        console.error(`未知资料条目: ${id}`);
        process.exit(1);
      }
      await setEntryMeta(stateDir, id, patch);
      await buildLibraryIndex(options);
      return;
    }
    if (context.rest[0] === "review" && context.rest.length === 1) {
      const entries = searchLibrary((await buildLibraryIndex(options)).entries, "", { needsReview: true });
      if (entries.length === 0) console.log("没有待复审条目");
      else print(entries);
      return;
    }
    console.error(usage);
    process.exit(1);
  },
});

registerCliCommand({
  name: "lessons",
  run: async (context: CliContext) => {
    const usage = "用法: kunpeng lessons <list|distill|consolidate|harvest> [--days N] [--apply-merges] [--write] [--repo <路径>]";
    const subcmd = context.rest[0];
    const stateDir = resolveProjectStateDir(context.repoRoot);
    if (subcmd === "list" && context.rest.length === 1) {
      const lessons = await listLessons(stateDir);
      if (lessons.length === 0) {
        console.log("暂无已蒸馏教训");
        return;
      }
      for (const lesson of lessons) {
        console.log(
          `${lesson.title}｜${lesson.polarity}｜${lesson.signature ?? "-"}｜injected=${lesson.stats.injected},wins=${lesson.stats.wins},losses=${lesson.stats.losses}`,
        );
      }
      return;
    }
    if (subcmd === "distill") {
      let days = 7;
      if (context.rest.length > 1) {
        const raw = context.rest[2];
        const parsedDays = Number(raw);
        if (
          context.rest.length !== 3
          || context.rest[1] !== "--days"
          || raw === undefined
          || !/^[1-9]\d*$/.test(raw)
          || !Number.isSafeInteger(parsedDays)
        ) {
          console.error(usage);
          process.exit(1);
        }
        days = parsedDays;
      }
      const result = await distillFailureLessons(context.repoRoot, { stateDir, days });
      console.log(`[教训蒸馏] 扫描 ${result.attempted} 条失败流，写入 ${result.written} 条，跳过 ${result.skipped} 条`);
      return;
    }
    if (subcmd === "harvest") {
      // 只读本机 Claude Code / Codex 会话；默认只预览，--write 才写入（trustTier 0，待人工确认）。
      const args = context.rest.slice(1);
      const write = args.includes("--write");
      const daysIndex = args.indexOf("--days");
      const days = daysIndex >= 0 ? Number(args[daysIndex + 1]) : 7;
      const known = args.every((arg, i) => arg === "--write" || arg === "--days" || (i === daysIndex + 1 && daysIndex >= 0));
      if (!known || !Number.isInteger(days) || days < 1 || days > 90) {
        console.error(usage);
        process.exit(1);
      }
      const files = await findSessionFiles(homedir(), Date.now() - days * 86_400_000);
      const result = await harvestSessions(files, Date.now(), userInfo().username);
      console.log(`[会话采集] 扫描 ${result.files} 个会话文件，候选 ${result.candidates} 条（去重后 ${result.lessons.length}，注入特征丢弃 ${result.dropped}）`);
      for (const lesson of result.lessons.slice(0, 20)) console.log(`- ${lesson.title}`);
      if (write) {
        for (const lesson of result.lessons) await appendLesson(stateDir, lesson);
        console.log(`[会话采集] 已写入 ${result.lessons.length} 条 trustTier 0 候选教训（经人确认后才可晋级）`);
      } else {
        console.log("[会话采集] 预览模式，未写入；加 --write 写入候选教训");
      }
      return;
    }
    if (subcmd === "consolidate") {
      const apply = context.rest[1] === "--apply-merges";
      if (context.rest.length > (apply ? 2 : 1)) {
        console.error(usage);
        process.exit(1);
      }
      const lessons = await listLessons(stateDir);
      const plan = planConsolidation(lessons);
      console.log(
        `[教训整编] 合并组 ${plan.merges.length}，毕业候选 ${plan.graduateProposals.length}，退役候选 ${plan.retireProposals.length}`,
      );
      for (const merge of plan.merges) {
        console.log(`[确定性合并] keep=${merge.keep} drop=${merge.drop.join(",")}｜${merge.reason}`);
      }
      for (const proposal of plan.graduateProposals) {
        console.log(`[毕业提案] ${proposal.id}｜${proposal.reason}`);
      }
      for (const proposal of plan.retireProposals) {
        console.log(`[退役提案] ${proposal.id}｜${proposal.reason}`);
      }
      if (apply) {
        const merged = applyMerges(lessons, plan.merges);
        const path = join(stateDir, "skills", "lessons.jsonl");
        await writeFileAtomic(path, `${merged.map((lesson) => JSON.stringify(lesson)).join("\n")}\n`);
        console.log(`[教训整编] 已应用 ${plan.merges.length} 组合并，保留 ${merged.length} 条 Lesson；毕业/退役仍仅为提案`);
      }
      return;
    }
    console.error(usage);
    process.exit(1);
  },
});

registerCliCommand({
  name: "distill-skill",
  run: async (context: CliContext) => {
    const name = context.rest[0];
    if (!name) { console.error('用法: kunpeng distill-skill <name> [--desc "<描述>"] [--repo <仓库>]'); process.exit(1); }
    const store = new ArtifactStore(join(context.repoRoot, ".kunpeng", "artifacts"));
    try {
      const result = await distillSkillToFile({
        store,
        outDir: join(context.repoRoot, ".kunpeng", "skills"),
        name,
        description: context.descArg ?? name,
      });
      const dir = dirname(result.path);
      try {
        registerSkill(skillsRoot(), {
          id: basename(dir),
          name,
          description: context.descArg ?? name,
          origin: "distilled",
          dir,
        });
      } catch (e) {
        console.warn(`[技能蒸馏] 注册失败：${(e as Error).message}`);
      }
      const slug = slugify(name);
      const proposalId = `skill-${slug}-${Date.now().toString(36)}`;
      await persistProposal(store, proposalId, {
        sourceExperiences: result.experienceIds,
        changes: [{ target: "skills", text: slug, source: "distill-skill" }],
        rejected: [],
      });
      console.log(`[技能蒸馏] 已生成提案 ${proposalId}，等待人工门 #2 批准。`);
      console.log(`[技能蒸馏] 已写 ${result.path}（蒸馏 ${result.experienceCount} 条经验）。在总控台人工门 #2 批准后经验真入 backlog 派流固化`);
    } catch (e) {
      if ((e as Error).message === "无经验可蒸馏（experience 为空）") {
        console.error("[技能蒸馏] 无经验可蒸馏（experience 为空）");
        process.exit(1);
      }
      throw e;
    }
    return;
  },
});

registerCliCommand({
  name: "skill",
  run: async (context: CliContext) => {
    const subcmd = context.rest[0];
    if (subcmd === undefined || subcmd === "list") {
      const skills = listSkills(skillsRoot());
      if (skills.length === 0) {
        console.log("暂无已注册技能，可用 kunpeng skill add <技能目录> 注册");
        return;
      }
      for (const skill of skills) {
        console.log(`${skill.id}｜${skill.name}｜${skill.origin}｜${(skill.tags ?? []).join(",")}｜${skill.category ?? "-"}｜${skill.enabled ?? true}`);
      }
      return;
    }

    if (subcmd === "pack") {
      // 只构建不发布：对外发布属宪法 C5#3 人工门。
      // --out 由 cli.ts 统一解析进 context.outArg（不会留在 rest 里）。
      const outDir = context.outArg ? resolve(context.outArg) : join(context.repoRoot, "dist-skills");
      if (context.rest.length !== 1) {
        console.error("用法: kunpeng skill pack [--out <目录>]");
        process.exitCode = 1;
        return;
      }
      const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: context.repoRoot, encoding: "utf8", timeout: 10_000 }).trim();
      const result = packSkills({ skillsRoot: join(context.repoRoot, "skills"), outDir, commit });
      for (const item of result.packed) {
        console.log(`[技能打包] ${item.name}@${item.version} → ${item.dir}${item.warn.length ? `（提示：${item.warn.join("、")}）` : ""}`);
      }
      for (const item of result.rejected) console.error(`[技能打包] 拒绝 ${item.dir}：${item.reasons.join("；")}`);
      console.log(`[技能打包] 打包 ${result.packed.length}，拒绝 ${result.rejected.length}；只构建、未发布（发布须人工门）`);
      if (result.rejected.length > 0) process.exitCode = 1;
      return;
    }

    if (subcmd === "validate") {
      const requested = context.rest[1];
      if (context.rest.length > 2 || requested?.startsWith("--")) {
        console.error("用法: kunpeng skill validate [name]");
        process.exitCode = 1;
        return;
      }

      const registered = listSkills(skillsRoot());
      const selected = requested === undefined
        ? registered
        : registered.filter((skill) => skill.id === requested || skill.name === requested);
      if (requested !== undefined && selected.length === 0) {
        console.error(`[技能校验] 未找到技能: ${requested}`);
        process.exitCode = 1;
        return;
      }
      if (requested !== undefined && selected.length > 1) {
        console.error(`[技能校验] 技能标识不唯一: ${requested}`);
        process.exitCode = 1;
        return;
      }

      let failed = false;
      for (const skill of selected) {
        const path = join(skill.dir, "SKILL.md");
        try {
          const result = validateSkillMd(readFileSync(path, "utf8"));
          if (result.ok) {
            console.log(`${skill.id}: ok`);
            continue;
          }
          failed = true;
          console.error(`${skill.id}:`);
          for (const error of result.errors) console.error(`  - ${error}`);
        } catch (error) {
          failed = true;
          console.error(`${skill.id}:`);
          console.error(`  - 无法读取或解析 ${path}: ${(error as Error).message}`);
        }
      }
      if (failed) process.exitCode = 1;
      return;
    }

    const optionValue = (flag: string): string | undefined => {
      const index = context.rest.indexOf(flag);
      if (index < 0) return undefined;
      const value = context.rest[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} 缺少值`);
      }
      return value;
    };

    const lifecycles: readonly SkillLifecycle[] = ["incubating", "active", "deprecated"];

    if (subcmd === "search") {
      const query = context.rest[1];
      if (query === undefined || query.startsWith("--")) {
        throw new Error("用法: kunpeng skill search <q> [--category c] [--disabled]");
      }
      const category = optionValue("--category");
      if (category !== undefined && !SKILL_CATEGORIES.includes(category as SkillCategory)) {
        throw new Error(`无效技能分类: ${category}`);
      }
      const results = searchSkills(skillsRoot(), query, {
        category: category as SkillCategory | undefined,
        enabled: context.rest.includes("--disabled") ? false : undefined,
      });
      for (const skill of results) {
        console.log(`${skill.id}｜${skill.name}｜${skill.category ?? "-"}｜${skill.enabled ?? true}`);
      }
      return;
    }

    if (subcmd === "enable" || subcmd === "disable") {
      const id = context.rest[1];
      if (!id || id.startsWith("--")) {
        throw new Error(`用法: kunpeng skill ${subcmd} <id>`);
      }
      setSkillFields(skillsRoot(), id, { enabled: subcmd === "enable" });
      console.log(`[技能] 已${subcmd === "enable" ? "启用" : "停用"} ${id}`);
      return;
    }

    if (subcmd === "set") {
      const id = context.rest[1];
      if (!id || id.startsWith("--")) {
        throw new Error("用法: kunpeng skill set <id> --category c|--lifecycle l|--project p|--stage s");
      }
      const category = optionValue("--category");
      const lifecycle = optionValue("--lifecycle");
      const project = optionValue("--project");
      const stage = optionValue("--stage");
      if (category !== undefined && !SKILL_CATEGORIES.includes(category as SkillCategory)) {
        throw new Error(`无效技能分类: ${category}`);
      }
      if (lifecycle !== undefined && !lifecycles.includes(lifecycle as SkillLifecycle)) {
        throw new Error(`无效技能生命周期: ${lifecycle}`);
      }
      if (category === undefined && lifecycle === undefined && project === undefined && stage === undefined) {
        throw new Error("skill set 至少需要一个字段选项");
      }

      const root = skillsRoot();
      const current = listSkills(root).find((skill) => skill.id === id);
      if (!current) throw new Error(`未找到技能: ${id}`);
      const patch: SkillFieldPatch = {};
      if (category !== undefined) patch.category = category as SkillCategory;
      if (lifecycle !== undefined) patch.lifecycle = lifecycle as SkillLifecycle;
      if (project !== undefined || stage !== undefined) {
        patch.appliesTo = {
          projects: project !== undefined ? [project] : current.appliesTo?.projects,
          stages: stage !== undefined ? [stage] : current.appliesTo?.stages,
        };
      }
      setSkillFields(root, id, patch);
      console.log(`[技能] 已更新 ${id}`);
      return;
    }

    if (subcmd === "categorize") {
      const result = categorizeAll(skillsRoot());
      console.log(`[技能分类] 已更新 ${result.updated} 个技能`);
      return;
    }

    if (subcmd === "add") {
      const dir = context.rest[1];
      if (!dir) {
        console.error("用法: kunpeng skill add <技能目录>");
        return;
      }
      const skillMd = join(dir, "SKILL.md");
      if (!existsSync(skillMd)) {
        console.error(`缺少 SKILL.md: ${skillMd}`);
        return;
      }
      const registered = registerSkill(
        skillsRoot(),
        skillEntryFromDir(dir, readFileSync(skillMd, "utf8"), "authored", basename(dir)),
      );
      console.log(`[技能] 已注册 ${registered.id}`);
      return;
    }

    if (subcmd === "import") {
      const dir = context.rest[1];
      if (!dir) {
        console.error("用法: kunpeng skill import <本地目录>");
        return;
      }
      const root = skillsRoot();
      const result = await importSkills(scanSkillDirs(dir), {
        exists: (name) => listSkills(root).some((skill) => skill.name === name),
        register: (candidate) => {
          const skillMd = readFileSync(join(candidate.dir, "SKILL.md"), "utf8");
          registerSkill(
            root,
            skillEntryFromDir(
              candidate.dir,
              skillMd,
              "external" as Parameters<typeof skillEntryFromDir>[2],
              basename(candidate.dir),
            ),
          );
        },
      });
      console.log(`[技能导入] 新增 ${result.imported.length} · 跳过 ${result.skipped.length}(已存在/失败)`);
      return;
    }

    if (subcmd === "remove") {
      const id = context.rest[1];
      if (!id) {
        console.error("用法: kunpeng skill remove <id>");
        return;
      }
      const removed = removeSkill(skillsRoot(), id);
      console.log(removed ? `[技能] 已移除 ${id}` : `[技能] 未找到 ${id}`);
      return;
    }

    console.error("用法: kunpeng skill <list|validate|search|enable|disable|set|categorize|add|import|remove> ...");
    return;
  },
});
