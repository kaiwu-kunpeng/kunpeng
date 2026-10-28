import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { CliRunner } from "../../agent/cli-runner.js";
import { ArtifactStore } from "../../artifacts/store.js";
import { ASK_SYSTEM, buildAskInput } from "../../knowledge/ask-context.js";
import { heuristicSummarize, runCapture } from "../../knowledge/capture-cli.js";
import { CaptureStore, resolveCapturesDir, type CapturePatch } from "../../knowledge/capture-store.js";
import { distillSkillToFile } from "../../knowledge/distill-skill.js";
import { selectDistillSource } from "../../knowledge/distill-source.js";
import { htmlToText } from "../../knowledge/html-to-text.js";
import { buildKbResponse } from "../../knowledge/kb-index.js";
import { promote } from "../../knowledge/promote.js";
import { recall } from "../../knowledge/recall.js";
import { pickResurfacing } from "../../knowledge/resurface.js";
import { buildSynthesizeInput, selectByTopic, SYNTH_SYSTEM } from "../../knowledge/synthesize.js";
import { buildTagCloud } from "../../knowledge/tagcloud.js";
import { fetchArticleViaXcrawl } from "../../knowledge/xcrawl-fetch.js";
import { fetchRefText } from "../../product/fetch-ref.js";
import { sharedDir } from "../../project/profile.js";
import { wrapUntrusted } from "../../security/prompt-shield.js";
import { extractFirstJsonObject } from "../../util/extract-json.js";
import { resolveRepo, registeredProjects } from "../project-scope.js";
import { readJsonBody } from "../read-body.js";
import { clip, stripMd } from "../ui/fmt.js";
import { registerModularRoute, type RouteContext } from "./registry.js";

function stripMdKnowledgeDisplayFields(card: { id: string; title?: string; summary?: string; raw?: string }): { title: string; summary: string } {
  const title = clip(stripMd(card.title ?? ""), 90)
    || clip(stripMd((card.raw ?? "").slice(0, 40)), 90)
    || card.id;
  return {
    title,
    summary: clip(stripMd(card.summary ?? ""), 160),
  };
}

function stripMdKnowledgeSummary(summary: string): string {
  return clip(stripMd(summary ?? ""), 160);
}

const KNOWLEDGE_CATEGORIES = new Set(["产品", "技术", "战略", "行业洞察", "运营增长", "工具方法", "其他"]);

registerModularRoute({
  method: "GET",
  path: "/api/knowledge-search",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    const query = String(q.get("q") ?? "");
    res.setHeader("content-type", "application/json");
    try {
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const store = new CaptureStore(resolveCapturesDir(repoRoot));
      if (query.trim() === "") {
        const captures = (await store.listCaptures())
          .sort((a, b) => {
            if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
            return a.id.localeCompare(b.id);
          })
          .map((capture) => ({
            id: capture.id,
            ...stripMdKnowledgeDisplayFields(capture),
            source: capture.source,
            tags: capture.tags,
            category: capture.category,
            citedFrom: capture.citedFrom,
            distill: capture.distill,
            distillLevel: capture.distillLevel,
            promoted: capture.promoted,
            createdAt: capture.createdAt,
          }));
        res.end(JSON.stringify({ ok: true, captures }));
        return;
      }
      const hits = await recall(query, { listCaptures: () => store.listCaptures() }, { limit: 20 });
      res.end(JSON.stringify({
        ok: true,
        hits: hits.map((hit) => ({
          ...hit,
          capture: {
            ...hit.capture,
            ...stripMdKnowledgeDisplayFields({
              id: hit.capture.id,
              title: hit.capture.title,
              summary: hit.capture.title,
              raw: hit.capture.text,
            }),
          },
        })),
      }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/kb",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const query = q.get("query") || undefined;
    res.setHeader("content-type", "application/json");
    try {
      const projects = await registeredProjects(context);
      const perProject = [];
      for (const p of projects) {
        const store = new CaptureStore(resolveCapturesDir(p.repoPath));
        let captures: Awaited<ReturnType<CaptureStore["listCaptures"]>> = [];
        try { captures = await store.listCaptures(); } catch { captures = []; }
        perProject.push({ projectId: p.id, projectName: p.name, captures });
      }
      let globalCaptures: Awaited<ReturnType<CaptureStore["listCaptures"]>> = [];
      try {
        globalCaptures = await new CaptureStore(join(sharedDir(), "knowledge")).listCaptures();
      } catch {
        globalCaptures = [];
      }
      const kb = buildKbResponse(perProject, query, globalCaptures);
      res.end(JSON.stringify({
        ok: true,
        ...kb,
        entries: kb.entries.map((entry) => ({
          ...entry,
          summary: stripMdKnowledgeSummary(entry.summary),
        })),
      }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/knowledge-resurface",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    res.setHeader("content-type", "application/json");
    try {
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const store = new CaptureStore(resolveCapturesDir(repoRoot));
      const captures = await store.listCaptures();
      const dayKey = Math.floor(Date.now() / 86400000);
      const picked = pickResurfacing(captures, dayKey, 5).map((capture) => ({
        id: capture.id,
        ...stripMdKnowledgeDisplayFields(capture),
        source: capture.source,
        tags: capture.tags,
        category: capture.category,
        citedFrom: capture.citedFrom,
        promoted: capture.promoted,
      }));
      res.end(JSON.stringify({ ok: true, captures: picked }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "GET",
  path: "/api/knowledge-tagcloud",
  handle: async (req, res, url, context: RouteContext) => {
    const q = new URL(url, "http://x").searchParams;
    const projectId = String(q.get("projectId") ?? "");
    res.setHeader("content-type", "application/json");
    try {
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const store = new CaptureStore(resolveCapturesDir(repoRoot));
      const { tags } = buildTagCloud(await store.listCaptures(), 40);
      res.end(JSON.stringify({ ok: true, tags }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/knowledge-synthesize",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const category = body.category ? String(body.category) : undefined;
    const tag = body.tag ? String(body.tag) : undefined;
    res.setHeader("content-type", "application/json");
    if (!category && !tag) {
      res.end(JSON.stringify({ ok: false, error: "需指定 category 或 tag" }));
      return;
    }
    try {
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const store = new CaptureStore(resolveCapturesDir(repoRoot));
      const caps = selectByTopic(await store.listCaptures(), { category, tag });
      const sources = caps.map((capture) => ({
        id: capture.id,
        title: capture.title ?? capture.summary ?? "",
      }));
      if (caps.length === 0) {
        res.end(JSON.stringify({ ok: true, brief: "该主题下还没有卡片。", sources: [] }));
        return;
      }
      const runner = new CliRunner();
      try {
        const out = await runner.run({
          stage: "spec",
          system: SYNTH_SYSTEM,
          input: wrapUntrusted("知识捕获卡片", buildSynthesizeInput(category ?? tag ?? "", caps)),
          tools: [],
        });
        res.end(JSON.stringify({ ok: true, brief: out.text, sources }));
      } catch {
        const brief = `该主题已有 ${caps.length} 张卡片,但当前 agent 不可用,暂时只能列出来源。`;
        res.end(JSON.stringify({ ok: true, brief, sources }));
      }
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/knowledge-ask",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const question = String(body.question ?? "").trim();
    res.setHeader("content-type", "application/json");
    if (question === "") {
      res.end(JSON.stringify({ ok: false, error: "问题不能为空" }));
      return;
    }
    try {
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const store = new CaptureStore(resolveCapturesDir(repoRoot));
      const hits = await recall(question, { listCaptures: () => store.listCaptures() }, { limit: 6 });
      if (hits.length === 0) {
        res.end(JSON.stringify({
          ok: true,
          answer: "知识库里没找到相关内容,先去捕获一些资料吧。",
          sources: [],
        }));
        return;
      }
      const runner = new CliRunner();
      const out = await runner.run({
        stage: "spec",
        system: ASK_SYSTEM,
        input: wrapUntrusted("知识捕获召回", buildAskInput(question, hits)),
        tools: [],
      });
      res.end(JSON.stringify({
        ok: true,
        answer: out.text,
        sources: hits.map((h) => ({ id: h.capture.id, title: h.capture.title ?? "" })),
      }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/knowledge-capture",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const kind = body.kind === "url" ? "url" : "text";
    const value = String(body.value ?? body.text ?? "");
    res.setHeader("content-type", "application/json");
    if (value.trim() === "") {
      res.end(JSON.stringify({ ok: false, error: "捕获内容不能为空" }));
      return;
    }
    try {
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const store = new CaptureStore(resolveCapturesDir(repoRoot));
      const baseDeps = {
        store,
        readFile: async () => { throw new Error("不支持 file"); },
        now: () => Date.now(),
        newId: () => `cap-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
      };

      async function organize(raw: string): Promise<{ summary: string; tags: string[]; category?: string; title?: string }> {
        try {
          const runner = new CliRunner();
          const out = await runner.run({
            stage: "spec",
            system: "你是知识整理助手。把给定内容浓缩成一句中文摘要 + 3~6 个标签 + 一个分类 + 原文标题。分类只能从这7个里选:产品/技术/战略/行业洞察/运营增长/工具方法/其他。原文标题用内容本身的标题(若有)。只输出 JSON：{\"summary\":\"...\",\"tags\":[\"...\"],\"category\":\"...\",\"title\":\"...\"}，不要任何额外文字。",
            input: wrapUntrusted("知识捕获原文", raw),
            tools: [],
          });
          const parsed = JSON.parse(extractFirstJsonObject(out.text)) as unknown;
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            typeof (parsed as { summary?: unknown }).summary === "string" &&
            Array.isArray((parsed as { tags?: unknown }).tags) &&
            (parsed as { tags: unknown[] }).tags.every((tag) => typeof tag === "string")
          ) {
            const parsedCategory = (parsed as { category?: unknown }).category;
            const category = typeof parsedCategory === "string" && KNOWLEDGE_CATEGORIES.has(parsedCategory)
              ? parsedCategory
              : "其他";
            return {
              summary: (parsed as { summary: string }).summary,
              tags: (parsed as { tags: string[] }).tags,
              category,
              title: typeof (parsed as { title?: unknown }).title === "string"
                ? (parsed as { title: string }).title
                : undefined,
            };
          }
        } catch {
          // Agent output is best-effort; capture still succeeds with deterministic fallback.
        }
        return { ...heuristicSummarize(raw), category: "其他", title: undefined };
      }

      if (kind === "url") {
        const cap = await runCapture(
          { kind: "url", value, projectId },
          {
            ...baseDeps,
            fetchUrl: async (u) => {
              const mcpUrl = process.env.XCRAWL_MCP_URL;
              if (mcpUrl) {
                try {
                  const md = await fetchArticleViaXcrawl(u, { mcpUrl });
                  if (md.trim()) return md;
                } catch {
                  // xcrawl is best-effort; fall back to the existing plain fetch path.
                }
              }
              // 逐跳过 SSRF 闸（重定向不自动跟随）+ 超时 + 体积上限，与 copy-ref 共用同一实现。
              return htmlToText(await fetchRefText(u));
            },
            summarize: organize,
          },
        );
        res.end(JSON.stringify({ ok: true, id: cap.id, title: cap.title, summary: cap.summary, category: cap.category, note: `已抓取并整理 ${cap.id}` }));
        return;
      }

      const cap = await runCapture(
        { kind: "text", value, projectId },
        {
          ...baseDeps,
          fetchUrl: async () => { throw new Error("cockpit 仅支持 text 捕获"); },
        },
      );
      res.end(JSON.stringify({ ok: true, id: cap.id, title: cap.title, summary: cap.summary, category: cap.category, note: `已捕获知识卡片 ${cap.id}` }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/knowledge-promote",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const id = String(body.id ?? "");
    res.setHeader("content-type", "application/json");
    try {
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const store = new CaptureStore(resolveCapturesDir(repoRoot));
      const r = await promote(id, { promoteCapture: (cid) => store.promoteCapture(cid) });
      if (r === null) { res.end(JSON.stringify({ ok: false, error: `知识卡片 ${id} 不存在` })); return; }
      res.end(JSON.stringify({ ok: true, note: `已采纳知识卡片 ${id}`, promoted: r.capture.promoted }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/knowledge-edit",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const id = String(body.id ?? "");
    res.setHeader("content-type", "application/json");
    try {
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const store = new CaptureStore(resolveCapturesDir(repoRoot));
      const patch: CapturePatch = {};
      if (Object.prototype.hasOwnProperty.call(body, "title")) patch.title = String(body.title ?? "");
      if (Object.prototype.hasOwnProperty.call(body, "summary")) patch.summary = String(body.summary ?? "");
      if (Object.prototype.hasOwnProperty.call(body, "category")) patch.category = String(body.category ?? "");
      if (Object.prototype.hasOwnProperty.call(body, "tags")) {
        if (typeof body.tags === "string") {
          patch.tags = body.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
        } else if (Array.isArray(body.tags)) {
          patch.tags = body.tags.map((tag) => String(tag).trim()).filter(Boolean);
        }
      }
      const capture = await store.editCapture(id, patch);
      if (capture === null) { res.end(JSON.stringify({ ok: false, error: "未找到该知识条目" })); return; }
      res.end(JSON.stringify({ ok: true, capture: { id: capture.id, title: capture.title, tags: capture.tags, category: capture.category } }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/knowledge-delete",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const id = String(body.id ?? "");
    res.setHeader("content-type", "application/json");
    try {
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const store = new CaptureStore(resolveCapturesDir(repoRoot));
      const ok = await store.deleteCapture(id);
      res.end(JSON.stringify(ok ? { ok } : { ok, error: "未找到该知识条目" }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/knowledge-distill-card",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const id = String(body.id ?? "");
    res.setHeader("content-type", "application/json");
    try {
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const store = new CaptureStore(resolveCapturesDir(repoRoot));
      const caps = await store.listCaptures();
      const cap = caps.find((c) => c.id === id);
      if (!cap) { res.end(JSON.stringify({ ok: false, error: `卡片 ${id} 不存在` })); return; }

      const nextLevel = Math.min((cap.distillLevel ?? 0) + 1, 3);
      const levelPrompt = nextLevel === 1
        ? "提炼这条知识的 3-5 个要点(每点一句中文),只输出 JSON：{\"distill\":\"- 要点1\\n- 要点2 ...\"}"
        : nextLevel === 2
          ? "在要点基础上,只保留最关键的 1-2 条洞察(中文,去掉次要),只输出 JSON：{\"distill\":\"...\"}"
          : "用你自己的话写一句可执行的执行摘要(中文,可直接用于决策/产出),只输出 JSON：{\"distill\":\"...\"}";
      const runner = new CliRunner();
      const out = await runner.run({
        stage: "spec",
        system: "你是知识渐进蒸馏助手。" + levelPrompt + " 不要任何额外文字。",
        input: wrapUntrusted("知识捕获原文", selectDistillSource(cap, nextLevel).slice(0, 6000)),
        tools: [],
      });
      let distillText = "";
      try {
        const parsed = JSON.parse(extractFirstJsonObject(out.text)) as { distill?: unknown };
        if (typeof parsed.distill === "string") distillText = parsed.distill;
      } catch {
        // Agent output parsing is best-effort; capture still updates via fallback.
      }
      if (!distillText) distillText = (cap.distill || cap.summary || "").slice(0, 200);
      await store.distillCapture(id, distillText, nextLevel);
      res.end(JSON.stringify({ ok: true, id, distill: distillText, distillLevel: nextLevel, note: `已深读到 L${nextLevel}` }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  },
});

registerModularRoute({
  method: "POST",
  path: "/api/distill-skill",
  handle: async (req, res, url, context: RouteContext) => {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? "");
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim() || name;
    res.setHeader("content-type", "application/json");
    try {
      if (!name) { res.end(JSON.stringify({ ok: false, error: "缺技能名称 name" })); return; }
      const repoRoot = await resolveRepo(context, projectId);
      if (!repoRoot) { res.end(JSON.stringify({ ok: false, error: `未知项目 ${projectId}` })); return; }
      const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
      const result = await distillSkillToFile({ store, outDir: join(repoRoot, ".kunpeng", "skills"), name, description });
      res.end(JSON.stringify({ ok: true, path: result.path, experienceCount: result.experienceCount, note: `已蒸馏技能 ${name}（${result.experienceCount} 条经验）` }));
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }));
    }
    return;
  },
});
