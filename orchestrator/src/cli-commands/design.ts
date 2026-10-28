import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CliRunner } from "../agent/cli-runner.js";
import { AgentDesignSource } from "../design/agent-source.js";
import { buildBrandContext } from "../design/brand-stage.js";
import { fetchBrand } from "../design/brand-import.js";
import type { DesignBrief } from "../design/brief-gate.js";
import { generateCandidates } from "../design/candidates.js";
import { pickCapturer } from "../design/capturers.js";
import { emitDesignCode } from "../design/codegen.js";
import type { DesignSource } from "../design/contract.js";
import { composeDeckPrompt } from "../design/design-deck.js";
import { toFigmaVariablePlugin, toShadcnRegistryItem, toTokensStudio } from "../design/design-export.js";
import { gateDesignArtifacts } from "../design/design-gate.js";
import { planDesign, gateDesign } from "../design/design-loop.js";
import { DesignMemoryStore, summarize as summarizeDesignMemory } from "../design/design-memory.js";
import { loadDesignPreset } from "../design/design-presets.js";
import { renderReview } from "../design/design-render-review.js";
import { buildFixPrompt } from "../design/design-review.js";
import { suggestDesign } from "../design/design-suggest.js";
import { writeMaster } from "../design/design-system-store.js";
import { captureScreenshot } from "../design/headless-shot.js";
import { housePresetSources, HouseDefaultSource } from "../design/house-source.js";
import { runDesignPipeline } from "../design/pipeline.js";
import { previewCandidates } from "../design/preview-candidates.js";
import { readDesignConfig } from "../project/design-config.js";
import { registerCliCommand, type CliContext } from "./registry.js";
import { valueAfter } from "./shared.js";

registerCliCommand({
  name: "design",
  run: async (context: CliContext) => {
    const brief = context.rest.filter((a) => !a.startsWith("--")).join(" ").trim();
    if (!brief) {
      console.error('用法: kunpeng design "<一句话设计需求>" [--page <名>] [--persist] [--repo <仓库>]');
      process.exit(1);
    }

    const result = runDesignPipeline(brief);
    console.log(`[design] 风格: ${result.advice.styles.map((style) => style.name).join(", ") || "(无匹配)"}`);
    console.log(`[design] 配色: ${result.master.palette ? JSON.stringify(result.master.palette) : "(无匹配)"}`);
    console.log(`[design] 字体: ${result.master.fonts ? JSON.stringify(result.master.fonts) : "(无匹配)"}`);
    console.log(result.masterMd);
    if (result.antiPatternHits.length === 0) {
      console.log("✓ 通过反AI味门禁");
    } else {
      for (const hit of result.antiPatternHits) {
        console.log(`✗ ${hit.id}: ${hit.rule}`);
      }
    }

    if (context.flags.has("--persist")) {
      const inferredSlug = brief.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
      const slug = context.pageArg ?? (inferredSlug || "draft");
      await writeMaster(join(context.repoRoot, "design-system"), slug, result.master);
      console.log(`[design] MASTER 已落盘: ${join(context.repoRoot, "design-system", slug)}`);
    }
    return;
  },
});

registerCliCommand({
  name: "design-memory",
  run: async (context: CliContext) => {
    // #8 读出设计记忆账本(并入 .kunpeng/loops 家族):按 桶/锚 的胜率排行。
    const store = new DesignMemoryStore(join(context.repoRoot, ".kunpeng", "loops", "design-memory"));
    const stats = summarizeDesignMemory(store.loadAll());
    if (stats.length === 0) { console.log("[design-memory] 暂无决策记录(跑过 design-loop --generate 后才有)"); return; }
    console.log("[design-memory] 设计记忆 · 按桶/锚胜率:");
    for (const s of stats) console.log(`  ${s.bucket} / ${s.anchor}: 胜 ${s.won}/${s.total}(${Math.round(s.winRate * 100)}%)`);
    return;
  },
});

registerCliCommand({
  name: "design-loop",
  run: async (context: CliContext) => {
    // 鲲鹏设计 Loop 一键跑:BRIEF投资门→记忆重排选锚→配色引擎→组合生成提示词→落盘;--generate 喂 CliRunner 真生成+门禁。
    const stop = context.rest.findIndex((a) => a.startsWith("--"));
    const oneLiner = (stop === -1 ? context.rest : context.rest.slice(0, stop)).join(" ").trim();
    const briefFile = valueAfter(context.rest, "--brief");
    const seedFlag = valueAfter(context.rest, "--seed");
    const anchorsRaw = valueAfter(context.rest, "--anchors");
    const anchorsFlag = anchorsRaw ? anchorsRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const doGen = context.rest.includes("--generate");
    // --preset <id>:套用 vendored 命名品牌设计系统(150 套之一)——取其品牌主色当种子 + DESIGN.md 注入生成。
    const presetId = valueAfter(context.rest, "--preset");
    const preset = presetId
      ? await loadDesignPreset(presetId, { rootDir: join(context.repoRoot, "orchestrator/src/design/vendor/design-systems") })
      : undefined;
    if (preset) console.log(`  [预设] ${preset.name}（${preset.category}）${preset.seedHex ? ` · 品牌主色 ${preset.seedHex}` : ""}`);

    let brief: Partial<DesignBrief>;
    if (briefFile) {
      brief = JSON.parse(await readFile(resolve(briefFile), "utf8")) as Partial<DesignBrief>;
    } else if (oneLiner) {
      brief = { primaryGoal: oneLiner, projectType: oneLiner }; // 故意不全 → 演示投资门
    } else {
      console.error('用法: kunpeng design-loop "<一句话>" | --brief <brief.json> [--preset <id>] [--seed <hex>] [--anchors a,b,c] [--generate] [--out <dir>] [--repo <仓库>]');
      process.exit(1);
      return;
    }

    // brand-import:--brand-domain <域名> → Brandfetch/brand.dev 自动取品牌色当种子(需 env API key,无则优雅跳过)。
    const brandDomain = valueAfter(context.rest, "--brand-domain");
    const brandAssets = brandDomain ? await fetchBrand(brandDomain) : null;
    if (brandDomain) console.log(brandAssets?.seedHex ? `  [品牌域名] ${brandDomain} → 种子色 ${brandAssets.seedHex}${brandAssets.fonts.length ? ` · 字体 ${brandAssets.fonts.join("/")}` : ""}` : `  [品牌域名] ${brandDomain} 未取到(缺 BRANDFETCH_API_KEY/BRAND_DEV_KEY 或网络)`);
    // #4 新旧统一:没给 --seed/--anchors 时,用老 knowledge BM25 从 brief 自动建议种子色+风格锚。优先级:--seed > 品牌域名 > 知识建议。
    const sugg = suggestDesign([brief.projectType, brief.primaryGoal, brief.tone].filter(Boolean).join(" "));
    const seed = seedFlag ?? preset?.seedHex ?? brandAssets?.seedHex ?? sugg.seedHex ?? "#2563eb";
    const anchors = anchorsFlag ?? (sugg.anchor ? [sugg.anchor] : undefined);
    if (!seedFlag && !brandAssets?.seedHex && sugg.seedHex) console.log(`  [建议] 种子色 ${sugg.seedHex}${sugg.styleName ? ` · 风格 ${sugg.styleName}` : ""}`);
    if (!anchorsFlag && sugg.anchor) console.log(`  [建议] 风格锚 ${sugg.anchor}`);

    const skillBaseline = await readFile(join(context.repoRoot, "orchestrator/src/design/vendor/frontend-design-skill.md"), "utf8");
    // 套用预设时,把该品牌设计系统的 DESIGN.md 拼进 baseline,让生成器遵循其设计语言。
    const baseline = preset
      ? `${skillBaseline}\n\n---\n# 参考品牌设计系统：${preset.name}\n严格遵循以下设计系统的语气、配色、排版与组件风格：\n\n${preset.designMd}`
      : skillBaseline;
    // 品牌 stage:--brand <brand.json> → BrandContext 作最高优先级单一真相喂生成。
    const brandFile = valueAfter(context.rest, "--brand");
    const brandCtx = brandFile ? buildBrandContext(JSON.parse(await readFile(resolve(brandFile), "utf8"))) : undefined;
    if (brandCtx) console.log(`  [品牌] ${brandCtx.name} · 原型 ${brandCtx.archetypeId}`);
    // #2 记忆回灌:读历史决策喂重排;采纳(--generate 出结果)后回写,让选锚越用越准。#8 co-locate 进 loops 家族。
    const memStore = new DesignMemoryStore(join(context.repoRoot, ".kunpeng", "loops", "design-memory"));
    const designHistory = memStore.loadAll();
    const plan = planDesign({ brief, seedHex: seed, baseline, anchors, bucket: brief.projectType, history: designHistory, brand: brandCtx });

    if (!plan.ok) {
      console.log("✗ BRIEF 投资门未过 —— 一句话不够,先把方向钉死。");
      if (plan.gate.missing.length) console.log(`  缺失字段: ${plan.gate.missing.join(", ")}`);
      if (plan.gate.violations.length) console.log(`  违规: ${plan.gate.violations.join("; ")}`);
      console.log("  补全后用 --brief <brief.json> 跑(10 字段见 docs/kunpeng-design-loop.md ①)。");
      return;
    }

    const tk = plan.tokens as { light: Record<string, { $value: string }>; dark: Record<string, { $value: string }> };
    console.log(`✓ BRIEF 门过 | 选锚: ${plan.chosenAnchor ?? "(未给候选)"} | 候选序: ${(plan.rankedAnchors ?? []).join(" > ") || "—"}`);
    console.log(`  配色(种子 ${seed}): primary ${tk.light.primary.$value} · 暗色 bg ${tk.dark.background.$value}`);
    if (plan.gate.warnings.length) console.log(`  提醒: ${plan.gate.warnings.join("; ")}`);

    const slug = (brief.projectType ?? "design").toLowerCase().replace(/[^a-z0-9一-龥]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "design";
    const outDir = context.outArg ? resolve(context.outArg) : join(context.repoRoot, ".kunpeng", "design-out", slug);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "BRIEF.md"), plan.briefMd ?? "", "utf8");
    await writeFile(join(outDir, "tokens.json"), JSON.stringify(plan.tokens, null, 2), "utf8");
    await writeFile(join(outDir, "system-prompt.md"), plan.systemPrompt ?? "", "utf8");
    // #5 保真:从 DTCG token 渲染 tokens.css(:root 明 + .dark 暗 + 字体变量),注入生成指令让生成器用精确 hex/字体,不自行 derive。
    const dtcg = plan.tokens as { light?: Record<string, { $value: string }>; dark?: Record<string, { $value: string }> };
    const toVars = (g?: Record<string, { $value: string }>) => g ? Object.entries(g).map(([k, v]) => `  --${k}: ${v.$value};`).join("\n") : "";
    const fontVars = plan.chosenFonts
      ? `\n  --font-display: "${plan.chosenFonts.display}";\n  --font-body: "${plan.chosenFonts.body}";${plan.chosenFonts.mono ? `\n  --font-mono: "${plan.chosenFonts.mono}";` : ""}`
      : "";
    const tokensCss = `:root{\n${toVars(dtcg.light)}${fontVars}\n}\n.dark{\n${toVars(dtcg.dark)}\n}\n`;
    await writeFile(join(outDir, "tokens.css"), tokensCss, "utf8");
    // C: shadcn registry-item(可 npx shadcn add);D: Tokens Studio/Figma 导入 JSON。
    await writeFile(join(outDir, "registry-item.json"), JSON.stringify(toShadcnRegistryItem(slug, dtcg), null, 2), "utf8");
    await writeFile(join(outDir, "figma-tokens.json"), JSON.stringify(toTokensStudio(dtcg), null, 2), "utf8");
    const figmaPlugin = toFigmaVariablePlugin(slug, dtcg);
    const figmaPluginDir = join(outDir, "figma-plugin");
    await mkdir(figmaPluginDir, { recursive: true });
    await writeFile(join(figmaPluginDir, "manifest.json"), JSON.stringify(figmaPlugin.manifest, null, 2), "utf8");
    await writeFile(join(figmaPluginDir, "code.js"), figmaPlugin.code, "utf8");
    await writeFile(join(figmaPluginDir, "ui.html"), figmaPlugin.uiHtml, "utf8");
    console.log(`  已落盘: ${outDir} (BRIEF.md / tokens.json / tokens.css / registry-item.json / figma-tokens.json / figma-plugin/ / system-prompt.md)`);

    if (doGen) {
      // 自动回炉:生成→门禁(确定性linter)+渲染体检(离色/重复/臃肿)→不过则 buildFixPrompt 回炉重生,直到过或轮次耗尽。
      // 真截图视觉复评仍归 agent 层(MCP);这里是纯 CLI 可跑的确定性闭环。
      const maxRounds = Math.max(1, Math.min(5, Number(valueAfter(context.rest, "--rounds")) || 1));
      // E:--deck 生成幻灯片 deck(而非单页),系统提示词包成 deck 提示词。
      const isDeck = context.rest.includes("--deck");
      const slides = Number(valueAfter(context.rest, "--slides")) || undefined;
      const outRule = "\n\nCRITICAL OUTPUT FORMAT: Respond with the complete HTML document ONLY. Your reply MUST start with the characters `<!doctype html>` and end with `</html>`. Do NOT write any prose, explanation, commentary, summary, or '已生成…' before or after. No markdown code fences. If you write anything other than raw HTML the output is unusable.";
      const genInstruction = (isDeck
        ? `Produce a single self-contained index.html that is a 16:9 SLIDE DECK (one <section> per slide, keyboard arrows to advance, inline <style>, web fonts via <link>). Use EXACTLY these design tokens as CSS custom properties — do NOT invent other brand colors, use the named fonts:\n${tokensCss}\nKeep it lean.`
        : `Produce a single self-contained index.html (inline <style>, web fonts via <link>) that realizes this design system and BRIEF. Use EXACTLY these design tokens as CSS custom properties — do NOT invent other brand colors, and use the named fonts:\n${tokensCss}\nKeep it lean.`) + outRule;
      const runner = new CliRunner();
      let sysPrompt = isDeck
        ? composeDeckPrompt(plan.systemPrompt ?? "", { locale: brief.locale, slides })
        : (plan.systemPrompt ?? "");
      let html = "";
      let passed = false;
      for (let round = 1; round <= maxRounds; round++) {
        console.log(`  生成中(第 ${round}/${maxRounds} 轮,CliRunner 注入设计系统提示词)…`);
        // 生成走 design 阶段:claude 后端经 CLAUDE_TIER 路由到 opus(更强视觉生成);我们捕获 res.text 自写文件,不依赖 stage 的写文件指令。
        const res = await runner.run({ stage: "design", system: sysPrompt, tools: [], input: genInstruction, cwd: outDir });
        const fence = res.text.match(/```(?:html)?\s*\n([\s\S]*?)```/);
        html = fence ? fence[1] : res.text;
        const gate = gateDesign({ html }); // 只传 html;styleText 自抽 <style>/inline
        const rr = renderReview(html, plan.tokens as Parameters<typeof renderReview>[1]);
        passed = gate.pass && rr.pass;
        const mustFix = [...rr.issues, ...(gate.pass ? [] : ["命中三大 AI 默认审美,改用非默认的配色/版式"])];
        console.log(`    门禁 ${gate.pass ? "✓" : `✗P0=${gate.lint.counts.P0}`} · 体检 ${rr.pass ? "✓" : `✗${rr.issues.length}问题`}${mustFix.length ? " → " + mustFix.join("; ") : ""}`);
        if (passed || round === maxRounds) break;
        sysPrompt = buildFixPrompt(sysPrompt, mustFix); // 回炉:把必修项拼进下一轮提示词
      }
      await writeFile(join(outDir, "index.html"), html, "utf8");
      console.log(`  生成完: ${join(outDir, "index.html")} | ${passed ? "✓ 通过(门禁+渲染体检)" : "✗ 仍有问题(已达轮次上限,产物已落盘)"}`);
      try {
        const verdict = await gateDesignArtifacts({ outDir, htmlFile: "index.html", repoRoot: context.repoRoot, baseline: true });
        const d = verdict.decision;
        console.log(`[design] tier-gate：tier1AutoPass=${d.tier1AutoPass} blockers=${d.blockers.join(",")}`);
        if (d.tier1AutoPass === false) process.exitCode = 1;
      } catch (e) {
        console.log(`[design] tier-gate 探针不可用，跳过硬门：${(e as Error).message}`);
      }
      // #6 真截图:系统 headless Chrome 出 shot.png(供人工/agent 视觉复评;无 Chrome 则跳过)。
      const shotOk = await captureScreenshot({ url: `file://${join(outDir, "index.html")}`, out: join(outDir, "shot.png"), width: 1280, height: 900 });
      console.log(shotOk ? `  截图: ${join(outDir, "shot.png")}(供视觉复评)` : "  截图: 跳过(未找到系统 Chrome)");
      // #2 回写记忆:本次(桶,选锚)是否产出通过的设计 → rankAnchors 越用越准。
      if (plan.chosenAnchor) {
        memStore.append({ bucket: brief.projectType ?? "", anchor: plan.chosenAnchor, won: passed, at: Date.now() });
        console.log(`  记忆已回写: ${brief.projectType ?? "(无桶)"} / ${plan.chosenAnchor} → ${passed ? "胜" : "未过"}`);
      }
    }
    return;
  },
});

registerCliCommand({
  name: "design-preview",
  run: async (context: CliContext) => {
    // P7b 真渲染：生成 3 套 House 候选 → 渲染截图存 .kunpeng/previews/，供总控台展示+点选。
    // 默认 playwright 截图器；--agent 走后端 agent 的浏览器工具(chrome-devtools MCP/computer-use/codex)。
    const outDir = join(context.repoRoot, ".kunpeng", "previews");
    // 候选来源池：--sources house,claude,figma,stitch（默认 house = 3 预设，快/可靠）。
    // house=进程内确定性；claude/figma/stitch=agent-mediated 外部来源（经后端工具，慢/可缺）。
    const dpRunner = new CliRunner();
    const sources: DesignSource[] = [];
    for (const s of (context.sourcesArg ?? "house").split(",").map((x) => x.trim()).filter(Boolean)) {
      if (s === "house") sources.push(...housePresetSources());
      else if (s === "claude" || s === "claude-native") sources.push(new AgentDesignSource({ name: "claude-native", runner: dpRunner, styleBrief: "Claude 自身设计品味：干净专业、反 AI-slop、清晰层级、克制配色" }));
      else if (s === "figma") sources.push(new AgentDesignSource({ name: "figma", runner: dpRunner, styleBrief: "从 Figma 设计文件结构化提取 tokens 与组件", tools: ["figma"] }));
      else if (s === "stitch") sources.push(new AgentDesignSource({ name: "stitch", runner: dpRunner, styleBrief: "Google Stitch design-first 从提示生成", tools: ["stitch"] }));
    }
    if (!sources.length) sources.push(...housePresetSources());
    const indexed = await generateCandidates(sources, { planMd: context.rest.join(" ") || "" });
    // 适配: generateCandidates 产 {index,contract}，previewCandidates 要 {source,contract}（跨流类型分歧，从 contract.source 取）。
    const candidates = indexed.map((c) => ({ source: c.contract.source, contract: c.contract }));
    const kind = context.flags.has("--agent") ? "agent" : undefined;
    const capturer = pickCapturer({ kind, runner: new CliRunner() });
    console.log(`[设计预览] ${candidates.length} 套候选，渲染中（${kind ?? "playwright"}）…`);
    const previews = await previewCandidates(candidates, capturer, outDir);
    const manifest = previews.map((p, i) => ({ index: i, source: p.source, anchor: p.anchor, png: `cand-${i}.png` }));
    await writeFile(join(outDir, "candidates.json"), JSON.stringify(manifest, null, 2), "utf8");
    console.log(`[设计预览] 完成 → ${outDir}`);
    for (const p of previews) console.log(`  ${p.source} ｜ ${p.anchor} → ${p.pngPath}`);
    console.log(`  去总控台看 3 套真渲染候选并点选（保存进 .kunpeng/project.json 的 design）。`);
    return;
  },
});

registerCliCommand({
  name: "design-codegen",
  run: async (context: CliContext) => {
    // 选定的设计契约 → 生成前端代码产物(tokens/shadcn install/starter)。把设计臂接到产品。
    const design = await readDesignConfig(context.repoRoot);
    if (!design?.source) { console.log("[设计codegen] 未选定设计——先 design-preview 渲染候选、在总控台点选。"); return; }
    // 重解析选定来源的契约(house 预设确定性；agent 来源经后端再产)。
    let contract;
    if (design.source.startsWith("house:")) {
      contract = (await new HouseDefaultSource(design.source.slice("house:".length)).resolve({ planMd: "" })).contract;
    } else {
      contract = (await new AgentDesignSource({ name: design.source, runner: new CliRunner(), styleBrief: design.anchor ?? design.source }).resolve({ planMd: context.rest.join(" ") })).contract;
    }
    const outDir = join(context.repoRoot, ".kunpeng", "design-code");
    const files = await emitDesignCode(contract, outDir);
    console.log(`[设计codegen] 选定 ${design.source}（${contract.anchor}）→ 生成 ${files.length} 个前端产物 → ${outDir}`);
    for (const f of files) console.log(`  ${f.kind} → ${f.path}`);
    console.log(`  globals.css/tailwind.theme.css = token；INSTALL.md = shadcn 装组件；starter.html = 可渲染样例。`);
    try {
      const verdict = await gateDesignArtifacts({ outDir, repoRoot: context.repoRoot, baseline: true });
      const d = verdict.decision;
      const status = d.tier1AutoPass ? "✓ 自动放行" : d.needsHumanReview ? "待人审（新/改基线）" : "✗ 拦截";
      console.log(`  tier 门：${status}${d.blockers.length ? " · " + d.blockers.join("、") : ""} → ${join(outDir, "tier-gate.json")}`);
    } catch (e) {
      console.log(`  tier 门跳过（探针不可用：${(e as Error).message}）`);
    }
    return;
  },
});
