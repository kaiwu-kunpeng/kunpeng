import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { heuristicSummarize, runCapture } from "../knowledge/capture-cli.js";
import { CaptureStore, resolveCapturesDir } from "../knowledge/capture-store.js";
import { aggregateCaptures, renderKbIndex, type ProjectCaptures } from "../knowledge/kb-index.js";
import { recall } from "../knowledge/recall.js";
import { promote, type PromoteDeps } from "../knowledge/promote.js";
import { readRegistry, kunpengStateDir } from "../project/registry.js";
import { sharedDir } from "../project/profile.js";
import { registerCliCommand, type CliContext } from "./registry.js";

const CAPTURE_USAGE = "用法: kunpeng capture <text|url|file> <value> [--project <id>] [--global] [--repo <repo>]";
const RECALL_USAGE = "用法: kunpeng recall <query...> [--limit N] [--repo <repo>]";

registerCliCommand({
  name: "capture",
  usage: CAPTURE_USAGE,
  run: async (context: CliContext) => {
    const [kind, value, ...captureRest] = context.rest;
    if ((kind !== "text" && kind !== "url" && kind !== "file") || !value) {
      console.error(CAPTURE_USAGE);
      process.exit(1);
    }

    let projectId: string | undefined;
    let global = false;
    for (let i = 0; i < captureRest.length; i++) {
      const arg = captureRest[i];
      if (arg === "--global") {
        global = true;
        continue;
      }
      if (arg !== "--project") {
        console.error(CAPTURE_USAGE);
        process.exit(1);
      }
      const next = captureRest[++i];
      if (!next || next.startsWith("--")) {
        console.error(CAPTURE_USAGE);
        process.exit(1);
      }
      projectId = next;
    }

    const capture = await runCapture(
      { kind, value, projectId, sourceProfileId: global ? "home" : undefined },
      {
        store: new CaptureStore(global ? join(sharedDir(), "knowledge") : resolveCapturesDir(context.repoRoot)),
        fetchUrl: async (url) => {
          const response = await fetch(url);
          return await response.text();
        },
        readFile: async (path) => await readFile(path, "utf8"),
        now: Date.now,
        newId: () => `cap-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      },
    );
    if (capture.duplicate === true) {
      console.log("[capture] 跳过：内容与已有条目重复（去重命中）");
      return;
    }
    console.log(`[capture] ${capture.id} ｜ ${capture.summary ?? ""}`);
    return;
  },
});

registerCliCommand({
  name: "kb",
  run: async (context: CliContext) => {
    const qIdx = context.rest.indexOf("--query");
    const query = qIdx >= 0 ? context.rest[qIdx + 1] : undefined;
    const projects = await readRegistry(kunpengStateDir());
    const perProject: ProjectCaptures[] = [];
    for (const p of projects) {
      const store = new CaptureStore(resolveCapturesDir(p.repoPath));
      const captures = await store.listCaptures().catch((): ProjectCaptures["captures"] => []);
      perProject.push({ projectId: p.id, projectName: p.name, captures });
    }
    const globalCaptures = await new CaptureStore(join(sharedDir(), "knowledge"))
      .listCaptures()
      .catch((): ProjectCaptures["captures"] => []);
    const entries = aggregateCaptures(perProject, query, globalCaptures);
    const out = join(context.repoRoot, "docs", "knowledge-index.md");
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, renderKbIndex(entries, query), "utf8");
    console.log(`[kb] 聚合 ${projects.length} 个项目 → ${entries.length} 条${query ? `（过滤「${query}」）` : ""} → ${out}`);
    return;
  },
});

registerCliCommand({
  name: "recall",
  usage: RECALL_USAGE,
  run: async (context: CliContext) => {
    const queryParts = context.rest.filter((part) => !part.startsWith("--"));
    const query = queryParts.join(" ").trim();
    if (!query) {
      console.error(RECALL_USAGE);
      process.exit(1);
    }

    let limit: number | undefined;
    if (context.limitArg !== undefined) {
      limit = Number(context.limitArg);
      if (!Number.isFinite(limit) || limit <= 0) {
        console.error(RECALL_USAGE);
        process.exit(1);
      }
    }

    const store = new CaptureStore(resolveCapturesDir(context.repoRoot));
    const hits = await recall(query, { listCaptures: () => store.listCaptures() }, { limit });
    if (hits.length === 0) {
      console.log("无匹配");
      return;
    }
    for (const hit of hits) {
      console.log(`${hit.capture.id} ｜ ${hit.citation.source} ｜ ${hit.citation.snippet}`);
    }
    return;
  },
});

registerCliCommand({
  name: "promote",
  run: async (context: CliContext) => {
    const usage = "用法: kunpeng promote <captureId> [--enrich] [--repo <repo>]";
    const [id, ...promoteRest] = context.rest;
    if (!id || promoteRest.some((arg) => arg.startsWith("--"))) {
      console.error(usage);
      process.exit(1);
    }

    const store = new CaptureStore(resolveCapturesDir(context.repoRoot));
    const deps: PromoteDeps = {
      promoteCapture: (captureId) => store.promoteCapture(captureId),
      ...(context.flags.has("--enrich") ? { enrich: async (raw: string) => heuristicSummarize(raw) } : {}),
    };
    const result = await promote(id, deps);
    if (result === null) {
      console.log(`capture 不存在: ${id}`);
      return;
    }
    console.log(`已提升 ${id}`);
    if (result.enriched) {
      console.log(`summary: ${result.enriched.summary}`);
      console.log(`tags: ${result.enriched.tags.join(", ")}`);
    }
    return;
  },
});
