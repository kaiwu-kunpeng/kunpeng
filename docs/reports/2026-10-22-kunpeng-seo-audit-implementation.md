# 鲲鹏 1.2.0 SEO 审计实现细则

> 依据本目录源码和测试静态核对，2026-10-22。本文描述**代码已实现的能力**，不代表已对某个真实站点完成审计。代码位置均相对仓库根目录，行号指向当前目录快照。

## 1. 组成、入口与数据流

SEO 审计由两层组成。`orchestrator/src/seo/` 是可复用的抓取、规则、报告和 MCP 服务；`skills/seo-audit/` 是面向客户审计的工作流、补充采集脚本、评分口径与 HTML 成稿工具。两者并非同一套自动流程：CLI 的整站报告不会自动运行 skill 中的关键词、排名、速度、第三方数据或客户版 HTML 生成。

| 入口 | 行为与产物 | 实现位置 |
|---|---|---|
| `kunpeng seo-mcp serve` | 启动基于标准输入输出的 JSON-RPC/MCP 服务，列出并调用内置工具。 | `orchestrator/src/cli-commands/seo.ts:9`；`orchestrator/src/seo/serve-cmd.ts:12,37,48`；`orchestrator/src/seo/mcp-server.ts:83` |
| `kunpeng seo-mcp report <origin> [--out DIR] [--max-pages N]` | 抓取首页所在 origin，生成分层整站审计 JSON 与 Markdown，终端输出总灯和各层计数。默认输出到仓库 `.kunpeng/seo-reports`。 | `orchestrator/src/cli-commands/seo.ts:6,15`；`orchestrator/src/seo/report.ts:115,399` |
| MCP `seo_site_report` | 同一整站构建器，允许传 `allow`、`terms`、`sitemapUrl`、`outDir`，返回摘要和文件路径。 | `orchestrator/src/seo/tools.ts:493`；`orchestrator/src/seo/report.ts:409` |
| 客户审计 skill | 按 `full/audit.json` 驱动补抓、分析、排名、GEO 实测、评分、HTML 多版本和交付检查。它是操作规程及脚本集，不是 `seo-mcp report` 的内置子命令。 | `skills/seo-audit/SKILL.md:1`；`skills/seo-audit/assets/audit.example.json:1` |

核心调用链：CLI 或 MCP → `buildSiteReport()` → `crawlSite()` → 七层规则 → `renderSiteReportMarkdown()` / JSON 写盘。MCP 的独立工具则在 `builtinSeoTools()` 中注册，按需单独调用；`gscTools()` 插在工具列表中。位置：`orchestrator/src/seo/report.ts:115,176,299,399`；`orchestrator/src/seo/tools.ts:33,143`。

## 2. 抓取与基础数据模型

1. URL 仅接受 HTTP(S)，去掉 fragment 和路径尾部斜杠；只跟进同 origin 的 HTML 链接。每页记录请求 URL、最终 URL、状态码、深度、内容类型、标题、出链及错误。发生跳转时记录 `finalUrl`；整站内容层仅审计非跳转 HTML 页。位置：`orchestrator/src/seo/crawl.ts:4,44,68,87,137`；`orchestrator/src/seo/report.ts:127`。
2. 默认遵守 robots.txt；按解析后的 User-agent 组和 RFC 9309 风格 `Allow`/`Disallow`、通配符、`$` 判断，不能读取 robots 时抓取器按无规则继续。默认深度 10；抓取器默认 500 页，整站报告默认 300 页、并发 6；`seo_crawl_site` 工具把 `maxPages` 限在 1–500。CLI 报告的 `--max-pages` 没有这项 500 上限。位置：`orchestrator/src/seo/crawl.ts:87,106,166`；`orchestrator/src/seo/gates/robots-classes.ts:51,105,148`；`orchestrator/src/seo/report.ts:115`；`orchestrator/src/seo/tools.ts:20`。
3. 同一批可并发抓取，结果仍按队列顺序更新图，保证抓取结果确定性；跳转最终 URL 重新入队，跳转页不进入 HTML 内容层。位置：`orchestrator/src/seo/crawl.ts:172`；`orchestrator/src/seo/report.ts:130`。
4. Sitemap 支持普通 `urlset` 和一级索引，索引最多读取前 20 个子 sitemap；读取失败的子文件跳过。图模型计算入链数、深度、孤儿页、漏列页、断链以及 30 次迭代的 PageRank。位置：`orchestrator/src/seo/report.ts:79`；`orchestrator/src/seo/link-graph.ts:16,20,38,65`。
5. `countWords()` 支持空格分词及中日韩等连续文字，用于首个 HTML 和页面字数判定。位置：`orchestrator/src/seo/text-metrics.ts:4`。

## 3. 整站报告自动执行的七层

七层的 `ok` 均由该层是否有 `error` 决定；总灯也只看 `error` 总数，`warn` 与 `info` 仍被计入统计。默认报告会输出规则计数、每层状态、页面审计最差 20 页、SERP 重复组及部分证据，并非完整逐页结果。位置：`orchestrator/src/seo/report.ts:104,177,197,299,409`。

| 层 | 具体检查、关键口径 | 代码位置 |
|---|---|---|
| robots 三态 | 解析训练、AI 搜索、用户触发三类爬虫的访问状态；检查通配封站、搜索/用户类误封、sitemap 声明及策略期望。robots 检查与日志分类目前分别维护 `AI_BOT_CLASSES`、`AI_CRAWLERS` 两份名单，修改时需核对一致性。 | `orchestrator/src/seo/gates/robots-classes.ts:11,51,90,103,182,273`；`orchestrator/src/seo/bot-registry.ts:9` |
| 发现层存活 | 从 `llms.txt`、`robots.txt` 的 Sitemap、首页 `Link` 响应头和 JSON-LD 抽 URL，再探测可达性；默认跳过外部域，`llms.txt` 404 记 info，发现到的死链记 error。 | `orchestrator/src/seo/gates/discovery-liveness.ts:47,58,67,80,108` |
| sitemap 与孤儿页 | 对照 sitemap URL 和抓取内链：无入链为孤儿页（error），抓到却未列出和深度过大为 warn；支持路径前缀 `allow` 豁免，默认允许深度不超过 3。 | `orchestrator/src/seo/gates/sitemap-orphan.ts:27`；`orchestrator/src/seo/link-graph.ts:65` |
| 页面代码审计 | 提取 title、description、H1–H6、lang、charset、canonical、robots、hreflang、图片 alt、站内外链接、字数和乱码替换符。规则涵盖 title 10–60 字、description 50–160 字、缺/多 H1、标题跳级、缺 alt、alt 等于文件名、缺 lang、相对 canonical、noindex、hreflang 缺自指或 x-default、编码缺失/冲突与乱码。 | `orchestrator/src/seo/page-audit.ts:18,41,59,141` |
| SERP 行预算 | 标题默认上限 60 字，描述默认 60–160 字；检查缺失、超预算、截断后重复标题、重复描述，以及 `og:image` 缺失/尺寸。`noindex` 或 canonical 指向其他页的页面不进入重复组。这里是页面摘要模拟检查，**不查询实际搜索结果排名**。 | `orchestrator/src/seo/gates/serp-budget.ts:80,96,178` |
| canonical 目标 | 对非自指 canonical 抓目标，检查目标可达、目标 `noindex`、链式规范化与标题相似度；抓取失败在独立工具中转为 warn。 | `orchestrator/src/seo/gates/canonical-target.ts:68,77`；`orchestrator/src/seo/tools.ts:434` |
| 首个 HTML | 在初始 HTML 中统计可见字数，默认少于 150 词记空壳 error；检查空应用根节点、`noscript` 提示。独立工具还可给定期望文本、正则或 selector，断言首屏内容存在。 | `orchestrator/src/seo/gates/first-html.ts:28,35,114` |

传入 `terms` 时会追加第八层“撤稿扫描”：在可见正文、title/description、JSON-LD、FAQ、社交 meta 和发现层文本中找指定词；抓不到的页标未验证。CLI 的 `report` 入口没有暴露 `terms` 参数，MCP `seo_site_report` 可传。位置：`orchestrator/src/seo/report.ts:174,197`；`orchestrator/src/seo/gates/retraction-sweep.ts:5,51,101,160`；`orchestrator/src/seo/tools.ts:305,493`。

## 4. 可单独调用的 MCP 能力

所有下列工具在 `builtinSeoTools()` 注册（`orchestrator/src/seo/tools.ts:33`）。输入 schema 的必填字段由 `handleSeoMcp()` 检查；输出默认限制 12,000 字符，长结果会截断，故大站应取落盘 JSON。位置：`orchestrator/src/seo/mcp-server.ts:46,67,83,105`。

| 工具 | 能力与边界 | 主要实现 |
|---|---|---|
| `seo_audit_page` | 抓单页并返回完整页面字段及 findings；HTTP 非 2xx 报错。 | `orchestrator/src/seo/tools.ts:35`；`orchestrator/src/seo/page-audit.ts:59` |
| `seo_crawl_site` | 返回页数、状态码、深度、标题、robots 拦截；最多 500 页。 | `orchestrator/src/seo/tools.ts:85`；`orchestrator/src/seo/crawl.ts:87` |
| `seo_internal_links` | 抓取加 sitemap，返回孤儿、漏列、断链、深页、入链榜和 PageRank 榜。 | `orchestrator/src/seo/tools.ts:115`；`orchestrator/src/seo/link-graph.ts:65` |
| `seo_sitemap_gate` | 与上项共用图数据，但输出带错误等级的 gate findings 和豁免结果。 | `orchestrator/src/seo/tools.ts:161`；`orchestrator/src/seo/gates/sitemap-orphan.ts:27` |
| `seo_first_html_check` | 对单 URL 的首次 HTML 校验期望文本/正则/选择器及最小字数。 | `orchestrator/src/seo/tools.ts:200`；`orchestrator/src/seo/gates/first-html.ts:114` |
| `seo_robots_check` | 按三类爬虫及可选策略检查 robots/sitemap。 | `orchestrator/src/seo/tools.ts:249`；`orchestrator/src/seo/gates/robots-classes.ts:182` |
| `seo_retraction_sweep` | 对指定 URL、词条和发现文件做撤稿残留扫描。 | `orchestrator/src/seo/tools.ts:311`；`orchestrator/src/seo/gates/retraction-sweep.ts:160` |
| `seo_discovery_check` | 探测发现层 URL；可选外链探测和最大 URL 数。 | `orchestrator/src/seo/tools.ts:359`；`orchestrator/src/seo/gates/discovery-liveness.ts:108` |
| `seo_serp_budget` | 单批 URL 的标题、描述、分享图与重复检查；失败抓取记 warn。 | `orchestrator/src/seo/tools.ts:412`；`orchestrator/src/seo/gates/serp-budget.ts:80` |
| `seo_canonical_check` | 单批 URL 的 canonical 目标检查；支持相似度阈值。 | `orchestrator/src/seo/tools.ts:459`；`orchestrator/src/seo/gates/canonical-target.ts:77` |
| `seo_structured_data` | 抽取 JSON-LD，校验 JSON、schema.org context、富结果类型必填及推荐字段；无块只记 info。 | `orchestrator/src/seo/tools.ts:383`；`orchestrator/src/seo/gates/structured-data.ts:71,167` |
| `seo_hreflang_cluster` | 校验语言码、互相回指、目标状态、目标 canonical 自指、页面语言一致；支持最多目标数。 | `orchestrator/src/seo/tools.ts:337`；`orchestrator/src/seo/gates/hreflang-cluster.ts:10,55,118` |
| `seo_geo_citability` | `kp-geo-v1` 可引用度评分：回答优先、问句标题、统计出处、引语、更新日期、作者、服务端正文、结构化数据、可抽取列表/表格；不可观测项不进分母。它是页面内容可引用性启发式评分，**不是实际 AI 引用率**。 | `orchestrator/src/seo/tools.ts:56`；`orchestrator/src/seo/gates/geo-citability.ts:8,74,106,148` |
| `seo_ai_crawler_report` | 从 `ai_crawler_hits` 查询类别统计、逐日趋势、搜索抓到但用户爬虫未取页的路径漏斗；需要 `NEON_DATABASE_URL`。 | `orchestrator/src/seo/tools.ts:289`；`orchestrator/src/seo/ai-crawler-report.ts:28` |
| `seo_gsc_sites` / `seo_gsc_query` / `seo_gsc_inspect` | 只读列 GSC 站点，查点击/展现/CTR/平均排名，查最多 50 个 URL 的索引状态。需要 Google `authorized_user` ADC；query 默认结束日为当前日前 3 天、向前 28 天，单次最多 25,000 行。 | `orchestrator/src/seo/gsc.ts:13,63,172,178,212` |
| `seo_site_report` | 运行第 3 节七层整站报告并落 JSON/Markdown；可加撤稿词形成第八层。 | `orchestrator/src/seo/tools.ts:504`；`orchestrator/src/seo/report.ts:115` |
| `seo_indexnow_submit` | 将 URL 去重后写入 outbox，**不在工具调用时外发**；工具标记 destructive，MCP 默认拒绝，需 `KUNPENG_SEO_ALLOW_DESTRUCTIVE=1` 才能排队，后续 flush 另需放行和 `INDEXNOW_KEY`。 | `orchestrator/src/seo/tools.ts:541`；`orchestrator/src/seo/mcp-server.ts:115`；`orchestrator/src/seo/indexnow.ts:18` |

**接线边界：** 整站 `buildSiteReport()` 实际调用的层列表见 `orchestrator/src/seo/report.ts:177`。结构化数据、hreflang 集合、GEO 可引用度、GSC 和 AI 日志均已作为独立工具实现，但未进入七层总灯；不能把其单独执行结果说成整站报告已覆盖。`seo_internal_links` 的 PageRank 和断链也没有单独成为总灯层。

## 5. 客户审计 skill 的补充能力与产物

Skill 的统一配置是 `full/audit.json`，模板 `skills/seo-audit/assets/audit.example.json:1`。配置承载站点、市场语种、重点页、关键词、竞品、审计模式、版本、主题及输出编号。以下脚本各自运行并落盘；它们不是由 `seo-mcp report` 自动编排。操作顺序见 `skills/seo-audit/SKILL.md:29`。

| 阶段 | 已实现的脚本与输出 | 代码位置 |
|---|---|---|
| 补充抓取 | 广度优先抓站内页面，再补 sitemap URL；保存 gzip HTML、`pages.jsonl`、`sitemap-urls.json`。 | `skills/seo-audit/scripts/crawl.py:29,72,118,135,152` |
| 派生指标 | 从落盘 HTML 计算语种/正文语言、hreflang、标题描述/H1/图片、重点页关键词、入链/PageRank、绝对化宣称出处，输出 `analysis.json`。 | `skills/seo-audit/scripts/analyze.py:78,91,108,116,124,139,176` |
| 搜索需求 | 按市场抓 Google 自动补全，规则分类、过滤噪声，输出 `kw-library.json`；支持只重建分类。它提供需求线索，不是搜索量。 | `skills/seo-audit/scripts/kw_collect.py:18,36,51` |
| 实查排名 | SerpApi 按市场/主题选词，支持 dry-run 预算估计、缓存、品牌词被纠正后的原拼写重查，输出 `serp-rank.json`。需要 API key 和额度。 | `skills/seo-audit/scripts/serp_rank.py:54,75,104,127` |
| Google AI 概览 | 从排名原始缓存提取 AI Overview 引用、品牌点名等抽样指标，输出 `aio-stats.json`；不会自动覆盖其他 AI 引擎。 | `skills/seo-audit/scripts/aio_stats.py:23,30,48` |
| 速度与 HTTP | CrUX 真实用户指标、PSI 实验室数据，及跳转链、压缩、缓存头、单次 TTFB；分别输出 `cwv-batch.json`、`http-checks.json`。真实用户样本不足要记未测。 | `skills/seo-audit/scripts/cwv_batch.py:34,48,69`；`skills/seo-audit/scripts/http_checks.py:16,40` |
| 竞品 | 采集配置中的竞品首页，输出 `competitors.json`；不足以给竞品做全站评分。 | `skills/seo-audit/scripts/competitors.py:20,37` |
| 第三方数据 | 对已采集的外链、权威度、各国自然搜索、AI 可见度与来源数据计算对比指标，输出 `ext-metrics.json`；数据采集依赖已登录平台及单独权限。 | `skills/seo-audit/scripts/ext_metrics.py:31,36,62,75`；`skills/seo-audit/references/data-collection.md:145` |
| GEO 网页实测 | 固定题集与回答记录、官方事实基准，汇总无品牌问题的推荐率和品牌题的参数准确率，输出 `geo-probe.json`；需人工/网页端采样。 | `skills/seo-audit/scripts/geo_probe.py:27,54`；`skills/seo-audit/references/data-collection.md:164` |
| 评分 | SEO 七个分项权重为技术 20、页面规范 15、内容 15、关键词 15、内链 10、外链 15、速度 10；GEO 七项为爬虫可达 15、可引用性 20、引用率 20、点名率 10、推荐率 15、来源页覆盖 10、介绍准确 10。综合分为 SEO×0.6 + GEO×0.4；未测项从分母剔除。评分规则是文档契约，具体报告仍须按数据层逐项计算。 | `skills/seo-audit/references/rubric.md:1`；`skills/seo-audit/assets/g_core.py:48` |
| HTML 报告 | 以数据层生成客户 HTML，可出高管摘要、完整诊断、技术附录、方案执行版；四套主题和 SVG 图表；`diagnosis` 默认只写现状，`plan` 才追加建议、修改单、执行计划。 | `skills/seo-audit/assets/report_shell.py:28,47`；`skills/seo-audit/assets/brief.py:43`；`skills/seo-audit/assets/annex.py:91`；`skills/seo-audit/assets/playbook.py:148`；`skills/seo-audit/assets/themes.py:51`；`skills/seo-audit/assets/charts.py:31` |
| 交付质量门 | 数字账本 `N()`、判定句 `claim()`；净化/中文文风扫描、数字归属、改稿保真及专业度确定性评分。独立语言与逻辑审查属于 skill 流程要求，并非上述脚本自动完成。 | `skills/seo-audit/assets/g_core.py:7`；`skills/seo-audit/assets/claims.py:17,57`；`skills/seo-audit/scripts/scan_report.py:39`；`skills/seo-audit/scripts/number_gate.py:26`；`skills/seo-audit/scripts/fidelity_check.py:18,35`；`skills/seo-audit/scripts/pro_metrics.py:21,70` |

## 6. 相邻模块中的 SEO 能力

这些实现使用 SEO 信号，但不属于 `seo-mcp report` 七层，也不由客户审计 skill 自动执行：

| 模块 | 实际能力 | 代码位置 |
|---|---|---|
| 产品 Browser QA | 在浏览器 QA 中提示缺 title/description/H1/og:title/canonical/JSON-LD 或标题过长；`seoHints` 单独展示，不改变 QA 的通过裁决。 | `orchestrator/src/product/browser-qa.ts:31,54,122`；`orchestrator/test/product/seo-hints.test.ts:5` |
| 产品增长文件 | 根据产品定义创建 `llms.txt` 与 `seo.json`，仅在文件不存在时写入；它是内容生成入口，并非审计。 | `orchestrator/src/product/growth-files.ts:25,42,50` |
| 内链运营 recipe | `seo-internal-links` 的 `crawl` lever 抓取内链缺陷并保存快照；`submit-indexnow` 从已验证快照挑最多 50 个同源、robots 允许且 200 HTML 的漏列页，排入 outbox。 | `orchestrator/src/loop/seo-internal-links.ts:5`；`orchestrator/src/loop/recipes/seo-internal-links/runwave.ts:55,72,101`；`orchestrator/src/loop/recipes/seo-internal-links/core.ts:9,30` |

## 7. 开发时最容易混淆的口径

- **抓取覆盖 ≠ 全站全量。** `seo-mcp report` 从首页顺站内链接抓取，受页数、深度、robots、同 origin 限制；skill 的补充抓取会再补 sitemap。整站报告 JSON 是摘要，客户版页级指标应以 `analysis.json` 的同一分母计算。位置：`orchestrator/src/seo/crawl.ts:87`；`skills/seo-audit/references/data-collection.md:32,47`。
- **HTML 代码判定 ≠ 搜索引擎或 AI 的真实结果。** SERP budget 只看本页 title/description/OG；GEO 可引用度是规则分；实际排名、AI Overview、AI 推荐率需要独立采样数据。位置：`orchestrator/src/seo/gates/serp-budget.ts:80`；`orchestrator/src/seo/gates/geo-citability.ts:74`；`skills/seo-audit/scripts/serp_rank.py:75`；`skills/seo-audit/scripts/geo_probe.py:27`。
- **`ok=true` 只表示零 error。** Warn/info 仍需阅读；抓取失败、未配置 GSC/数据库、没有第三方数据都不能解释为对应领域通过。位置：`orchestrator/src/seo/report.ts:104,205`；`orchestrator/src/seo/gsc.ts:13`；`orchestrator/src/seo/tools.ts:299`。
- **整站 Markdown 与客户 HTML 是不同产物。** 前者由内置 CLI 直接生成；后者由 skill 的多脚本数据层、报告组件和质量门生成。位置：`orchestrator/src/seo/report.ts:299,399`；`skills/seo-audit/SKILL.md:47,59`。
- **自动发布不是审计本身。** Skill 写有公开短链、知识库归档的交付步骤；`seo_indexnow_submit` 则是索引通知入 outbox，均涉及后续外部动作，不应从只读检查结果推断它们已执行。位置：`skills/seo-audit/SKILL.md:89`；`orchestrator/src/seo/tools.ts:530`。

## 8. 验证索引

源码旁已有对应测试：抓取与跳转 `orchestrator/test/seo/crawl-links.test.ts`、`crawl-final-url.accept.test.ts`；页面规则 `page-audit.test.ts`；整站报告 `site-report.test.ts`、`site-report-tool.test.ts`；各门在 `gate-*.test.ts`、`*.accept.test.ts`；MCP 接线在 `mcp-server.test.ts`、`tools-wiring.test.ts`、`gates-wiring.test.ts`、`gates2-wiring.test.ts`、`gates3-wiring.test.ts`。本目录没有 `.git`、`orchestrator/dist/cli.js` 或 `orchestrator/node_modules`，因此本文的状态为**静态源码核对**，未声称运行测试或真实网站审计。

## 9. 判定模型：从单条发现到总灯

这里有三种不同含义的“OK”，开发时应分开看：

1. **规则/页面层**：`Finding` 只有 `error`、`warn`、`info` 三档，许多 gate 的 `ok = !findings.some(f => f.severity === "error")`。因此 `warn`、`info` 可以和 `ok=true` 同时出现。页面基础审计 `auditPageHtml()` 只返回 `findings`，不返回 `ok`。位置：`orchestrator/src/seo/page-audit.ts:4,59`；`orchestrator/src/seo/gates/robots-classes.ts:182`。
2. **整站层**：`buildSiteReport()` 将每层的 error/warn/info 相加；每层 `ok` 和 `totals.ok` 都仅取决于 error 数是否为零。它没有“未测”枚举，也不要求抓取页数或覆盖率达到下限。位置：`orchestrator/src/seo/report.ts:104,197,205`。
3. **客户评分层**：skill 的 `rubric.md` 使用检查项通过率和“未测/不适用”分母，最后才计算 SEO、GEO 和综合分。它不是 MCP gate 的 `ok` 布尔值，也没有一个自动调用全部数据脚本的总控函数。位置：`skills/seo-audit/references/rubric.md:1`；`skills/seo-audit/SKILL.md:29`。

例如：robots.txt 返回 404 时，`fetchRobotsGate()` 按空文件评估，附一个 `robots-missing` warn；默认又要求 Sitemap 声明，于是再得 `robots-sitemap-missing` warn，但没有 error，`ok` 仍可为 true。反过来，robots.txt 返回 500 或网络异常时是 `robots-status` error，`ok=false`。位置：`orchestrator/src/seo/gates/robots-classes.ts:246,262,273`。

**覆盖不等于通过。** 当前代码中，抓取器记录的普通页面 404/状态 0 并不会自动变成整站报告的 error；图谱的断链列表也未接入七层总灯。`seo_structured_data`、`seo_geo_citability` 的输入抓取失败会另列 `failed`，其已抓页面结果仍可能“绿”。`seo_hreflang_cluster` 的种子页抓不到或目标被 `maxTargets` 截断时，未被检查的页不会凭空产生 error。位置：`orchestrator/src/seo/crawl.ts:127`；`orchestrator/src/seo/report.ts:177`；`orchestrator/src/seo/tools.ts:383,337`；`orchestrator/src/seo/gates/hreflang-cluster.ts:69,118`。

## 10. 内链图谱如何建设

**输入事实。** 在线图谱从 `crawlSite()` 得到 `pages`（节点候选）和 `edges`（HTML `<a href>` 指向的站内 URL），另由 `loadSitemapUrls()` 得到 sitemap URL 集合。`extractLinks()` 去重、规范化 URL 并仅保留同 origin 链接；图边保留的是“来源页 URL → 链接目标 URL”。跳转页的最终 URL 会入队，但边仍以产生链接的请求页 URL 为来源。位置：`orchestrator/src/seo/crawl.ts:4,44,87,178`；`orchestrator/src/seo/report.ts:79,115`。

**构图方法 `buildLinkGraph()`。** 先以实际抓到的页面建 `byUrl` 和 `outgoing`；对边做 `[from,to]` 去重。非自环边给目标 `inbound[to] + 1`，即使目标没有被抓到，也可能在入链计数中出现。PageRank 的出边只保留“目标在已抓页面集合内”的边；同一目标的多条链接只算一条。目标已抓且状态为 4xx/5xx 或 0 时，边记入 `broken`；未抓到的目标不会被判成断链。位置：`orchestrator/src/seo/link-graph.ts:65`。

**派生结果和判定。** `orphans` 是“sitemap 中列出、非起始页、入链数为 0”的 URL；`notInSitemap` 是“已抓、状态 200、HTML 类型、却未列 sitemap”的页面；`deep` 是抓取深度大于默认 3 的已抓页面。`runSitemapOrphanGate()` 对 `orphans` 按路径前缀 `allow` 豁免；sitemap 空或未豁免孤儿页是 error，漏列和过深是 warn。`broken` 由图谱返回，但这道 sitemap gate 不把它变成 finding。位置：`orchestrator/src/seo/link-graph.ts:89,105`；`orchestrator/src/seo/gates/sitemap-orphan.ts:27,38`。

**PageRank 算法。** 仅对抓到的页面计算；初值各为 `1/N`，阻尼系数 0.85，固定迭代 30 次；无出边页面的权重均匀回流所有节点。工具 `seo_internal_links` 把入链数和 PageRank 各排序取前 20，并另外列出零入链页面。位置：`orchestrator/src/seo/link-graph.ts:38`；`orchestrator/src/seo/tools.ts:115`。

**另一套补充图。** 客户 skill 的 `crawl.py` 会在站内链接遍历后，补抓 sitemap 里没到达的 URL，并将其标成 `source=sitemap-only`、`depth=-1`。`analyze.py` 再用 `pages.jsonl` 的 `outlinks` 重建内链、入链数和 PageRank（阻尼同为 0.85，但迭代 50 次），按页面类型统计 PageRank 中位名次。两套图的范围、URL 归一化、节点数和迭代次数都可能不同，数字不应混用。位置：`skills/seo-audit/scripts/crawl.py:118,135,152`；`skills/seo-audit/scripts/analyze.py:124`。

**离线 HTML 目录入口。** `linkGraphFromHtmlDir()` 可把目录内 `.html` 映射成路由节点，忽略 `_` 或动态参数样式路径，读取页面链接，并从首页 BFS 回填深度。它用于离线页面图，不等同于在线抓取。位置：`orchestrator/src/seo/gates/sitemap-orphan.ts:71,81`。

## 11. “网站事实”如何建设和保存

本实现没有一个统一命名为 `SiteFacts` 的 SEO 数据库实体。可供审计复核的“网站事实”实际分为四层：

| 层 | 建设方式 | 保存与使用 |
|---|---|---|
| 原始响应事实 | 在线抓取保存请求 URL、最终 URL、HTTP 状态、Content-Type、标题、链接、深度；整站报告调用抓取器时 `keepHtml=true`，只在本次运行的内存中保留 HTML。 | `orchestrator/src/seo/crawl.ts:68,87,137`；`orchestrator/src/seo/report.ts:124` |
| 单页规范化事实 | `auditPageHtml()` 从 HTML/HTTP charset 提取 lang、title、description、canonical、robots、heading、图片、hreflang、内外链、字数与乱码数，再产出逐规则 findings。 | `orchestrator/src/seo/page-audit.ts:18,59`；`orchestrator/src/seo/report.ts:145` |
| 整站汇总事实 | `buildSiteReport()` 按七层聚合：抓取状态计数、跳转、robots、发现入口、sitemap 图谱、页面规则计数、SERP、canonical、首个 HTML；只保留最差 20 页等摘要。`writeSiteReport()` 写 JSON 和 Markdown。 | `orchestrator/src/seo/report.ts:36,115,222,399` |
| 客户审计的可追溯底稿 | `crawl.py` 把每页结构化记录写 `pages.jsonl`，原始 HTML gzip 保存到 `full/html/`，sitemap URL 写 `sitemap-urls.json`；`analyze.py` 从这些文件推导 `analysis.json`，每项比例带分母。后续排名、速度、第三方和 GEO 数据各有独立 JSON，最后报告从这组文件取数。 | `skills/seo-audit/scripts/crawl.py:72,115,152`；`skills/seo-audit/scripts/analyze.py:16,176`；`skills/seo-audit/SKILL.md:29` |

`crawl.py` 的 `extract()` 对每个 200 HTML 提取 title、description、canonical、lang、hreflang、H1 数、JSON-LD 类型、图片属性、第三方脚本、出链及正文词数。`analyze.py` 的 `detect()` 对短于 200 字的正文返回不可判定；`lang_valid()` 查语言码格式与基础语言集；`title_px()` 用字体实际宽度或字符估计判 600px；重点页主词同时查 title 和首个合格段落；最高级说法要在同一段有外站链接或配置的来源提示才计“有出处”。这些是派生事实与通过率的分子/分母，不自动转换成 MCP 的 `ok`。位置：`skills/seo-audit/scripts/crawl.py:72`；`skills/seo-audit/scripts/analyze.py:26,44,62,78,116,139`。

另有两种名称相近但不同用途的 facts：`orchestrator/src/product/growth-files.ts:5,12,25,42` 的 `ProductFacts` 来自产品定义，只用于生成 `llms.txt`、`seo.json`；`full/geo/facts.json` 是客户审计中人工整理的官方产品参数基准，供 AI 品牌题准确性核对，`geo_probe.py` 只汇总已标注的 `accurate/errors`，本身不自动从官网验证参数。位置：`skills/seo-audit/references/data-collection.md:170,178`；`skills/seo-audit/scripts/geo_probe.py:27,34`。

## 12. 编排、数据与协议文件：主要方法逐一说明

| 文件与方法 | 主要实现逻辑 | 如何判定/返回 |
|---|---|---|
| `orchestrator/src/seo/crawl.ts:4` `normalizeUrl()`、`extractLinks()` | 解析相对 URL，拒绝非 HTTP(S)，去 fragment 和尾斜杠；遍历 HTML `<a>` 并仅保留同 origin 链接。 | 解析失败返回 `null`；不生成 finding。 |
| `orchestrator/src/seo/crawl.ts:87` `crawlSite()` | 取 robots，BFS 排队；按深度、同源、robots 和页数限制入队；每批并发抓取但按原顺序处理，记录节点、边、状态、跳转。 | 网络异常写 `status=0/error`；返回 `blockedByRobots`，本方法没有 `ok`。 |
| `orchestrator/src/seo/link-graph.ts:16` `parseSitemapUrls()`、`parseSitemapIndex()` | 正则抽 `url` 或 `sitemap` 节点的 `<loc>`，规范化 URL 并去重。 | 无匹配返回空数组；无法区分空 sitemap 与解析失败。 |
| `orchestrator/src/seo/link-graph.ts:38` `calculatePageRank()`、`buildLinkGraph()` | 构入链、出链和状态索引，计算孤儿、漏列、断链、深页与 PageRank；细节见第 10 节。 | 返回事实数组，不返回 `ok`；由上层 gate 决定严重性。 |
| `orchestrator/src/seo/text-metrics.ts:4` `countWords()` | 用 `Intl.Segmenter` 计算中日韩、泰/老挝/高棉/缅甸等连续文字，其余按空白切词。 | 返回数量，不判好坏；首 HTML gate 用默认 150 门槛。 |
| `orchestrator/src/seo/page-audit.ts:59` `auditPageHtml()` | Cheerio 提取 SEO 字段和正文指标，再按 `PAGE_AUDIT_RULES` 稳定排序 findings。 | 缺 title/H1/lang、乱码、编码冲突为 error；标题/描述长度、alt、canonical、hreflang 等多为 warn；`noindex` 为 info。无全页 `ok`。 |
| `orchestrator/src/seo/report.ts:79` `loadSitemapUrls()` | 拉指定 sitemap；普通 urlset 直接解析，索引至多读 20 个子文件。 | 主 sitemap 读不到返回 `undefined`；后续 sitemap gate 将空列表判 error。 |
| `orchestrator/src/seo/report.ts:115` `buildSiteReport()` | 对首页抓取、七层评估，并可选 `terms` 撤稿扫描；只审非跳转 HTML，汇总层统计和最差页面。 | 每层与总灯仅以 error=0 判 `ok`；未检查项不形成独立失败。 |
| `orchestrator/src/seo/report.ts:299` `renderSiteReportMarkdown()` | 将摘要渲染为分层表、证据列表和建议；建议由 error 规则映射到固定文案。 | 展示结果，不再重新计算检查结论。 |
| `orchestrator/src/seo/report.ts:399` `writeSiteReport()`、`summarizeSiteReport()` | 以域名和 UTC 时间命名写 JSON/Markdown，返回文件路径、总数和最多十个问题摘要。 | 写盘异常向上抛；文件存在不代表本轮审计结果正确，需核对生成时间。 |
| `orchestrator/src/seo/bot-registry.ts:9` `AI_CRAWLERS`、`aiCrawlerFromUserAgent()` | 将 UA 按最长名称优先的正则匹配到训练/搜索/用户类；供访问日志分类。 | 未命中返回 `null`，日志报表归入 unknown；它与 robots gate 的名单是两份。 |
| `orchestrator/src/seo/ai-crawler-report.ts:28` `buildAiCrawlerReport()` | SQL 从 `ai_crawler_hits` 聚合 bot、日期和路径，生成类别计数、逐日趋势、搜索抓取与用户取页交集。 | 返回计数和漏斗，无“SEO 通过”阈值；缺数据库配置时工具返回 `ok:false` 错误信息。 |
| `orchestrator/src/seo/gsc.ts:13` `readGscAuth()` | 读指定或 gcloud 默认 ADC，要求 `authorized_user` 及 refresh token、client id/secret。 | 缺文件、非法 JSON 或字段不足返回 `{error}`；不猜授权状态。 |
| `orchestrator/src/seo/gsc.ts:63` `GscClient.token()` / `listSites()` / `searchAnalytics()` / `inspect()` | refresh token 换 access token 并缓存至过期前 60 秒；调用 GSC 站点、表现、索引 API。 | HTTP 非 OK 抛错；工具的 `withGscClient()` 转成 `{ok:false,error}`；成功查询是数据返回，不代表 SEO 无问题。 |
| `orchestrator/src/seo/gsc.ts:170` `gscTools()` | 注册三个只读工具；query 限维度白名单与最多 25,000 行，inspect 串行处理前 50 个 URL。 | inspect 单 URL 异常放入 `errors[]`，整个工具响应仍可能 `{ok:true}`，需看 `checked/results/errors`。 |
| `orchestrator/src/seo/mcp-server.ts:48` `defineSeoTool()`、`buildSeoToolIndex()` | 校验工具名 `seo_`/`gsc_`/`geo_` 前缀和重名。 | 非法或重名直接抛错。 |
| `orchestrator/src/seo/mcp-server.ts:83` `handleSeoMcp()`、`handleToolCall()` | 处理 initialize、tools/list、tools/call；先查必填参数，再拦 destructive 工具，执行并截断文本。 | 业务异常为 MCP `isError:true`；默认文本预算 12,000 字。仅查 `required` 是否缺失，不做完整 JSON Schema 类型校验。 |
| `orchestrator/src/seo/tools.ts:33` `builtinSeoTools()` | 为每个工具定义名称、schema、注解与 `run` 包装；抓页面后调对应 gate，部分工具汇总抓取失败。 | 各工具判定各异：部分失败是 error、部分是 warn、部分只在 `failed[]`；不能只看顶层 `ok`。 |
| `orchestrator/src/seo/serve-cmd.ts:12` `runSeoMcpStdio()`、`buildSeoServeDeps()` | 一行一个 JSON 请求/响应；从环境注入数据库 runner，并仅在环境开关为 `1` 时放行 destructive 工具。 | JSON 解析失败返回协议错误；默认不准 `seo_indexnow_submit` 排队。 |
| `orchestrator/src/seo/indexnow.ts:18` `submitIndexNow()` | 去重、去空白，最多 10,000 URL，POST 到 IndexNow；这是后续外发函数，不是 MCP 工具调用当场执行的逻辑。 | 空列表 `{ok:true,submitted:0}`；HTTP 错误/网络异常 `{ok:false}`。 |
| `orchestrator/src/cli-commands/seo.ts:9` CLI 注册 | `serve` 进 MCP；`report` 参数检查、调用构建器、写报告并打印各层统计。 | 缺合法 origin 输出用法并退出 1；审计本身有 error 时仍生成报告，CLI 未以总灯改退出码。 |

## 13. 各检查文件的具体 OK / 不 OK 条件

| 文件与主方法 | 检查逻辑 | 使 `ok=false` 的 error；其他信号 |
|---|---|---|
| `orchestrator/src/seo/gates/robots-classes.ts:51` `parseRobotsGroups()` / `effectiveGroup()` / `robotsPatternMatches()` / `isAllowedByRobots()` | 按 User-agent 组、最长匹配 token、最长规则及 Allow 同长优先规则判断具体路径；支持 `*`、末尾 `$`。 | 这些是纯解析/布尔函数；没有 finding。`verdictFor()` 另把首页规则概括成 allowed/partial/blocked。 |
| `orchestrator/src/seo/gates/robots-classes.ts:182` `runRobotsGate()` / `fetchRobotsGate()` | 逐 AI bot 分类看首页访问状态，并按策略核验。 | `*` 封全站、默认要求放行的搜索/用户 bot 被 blocked、robots HTTP 非 200/404 或网络失败为 error。训练类策略偏差、缺 Sitemap 为 warn；未知 agent 为 info；404 robots 自身为 warn。 |
| `orchestrator/src/seo/gates/discovery-liveness.ts:47` 四个抽取方法 / `runDiscoveryLiveness()` | 抓 `llms.txt`、robots 和首页，从文本、Sitemap 行、Link 头、JSON-LD 白名单键抽 URL；同源去重，默认最多探测 200 条。 | 被探测 URL 非 2xx/网络失败为 error；入口本身无法读为 warn；`llms.txt` 404 为 info；零可探测 URL 为 warn。外域默认跳过，不计失败。 |
| `orchestrator/src/seo/gates/sitemap-orphan.ts:27` `runSitemapOrphanGate()` | 用图谱的 sitemap/入链/深度结果。 | sitemap 为空、非豁免孤儿页为 error；漏列和深度 >3 为 warn；`allow` 只按 URL 路径前缀豁免孤儿，不豁免其他规则。 |
| `orchestrator/src/seo/gates/sitemap-orphan.ts:71` `htmlFileToPath()` / `linkGraphFromHtmlDir()` | 将静态 HTML 文件映射路由，并从首页沿出链算深度。 | 文件不匹配直接忽略；这两个方法只产图数据，不返回 gate `ok`。 |
| `orchestrator/src/seo/gates/first-html.ts:28` `visibleText()` / `checkFirstHtml()` / `runFirstHtmlGate()` | 剔除 script/style/noscript/template/svg，统计可见词；逐期望支持 selector、文本包含和 regex。 | 少于默认 150 词、任一期望不命中、抓取 HTTP 非 200/异常为 error；JS noscript 文案、空应用根为 warn。只有 `id` 而没有 text/regex 的期望一定不匹配。 |
| `orchestrator/src/seo/gates/serp-budget.ts:53` `normalizeSerpUrl()` / `rawTitle()` / `clipTitle()` / `runSerpBudgetGate()` | 读原始 `<title>` 源码（HTML 实体不解码），以 Unicode 字符截断；先排除 noindex/非自指 canonical 页面，再查长度、OG 图与重复组。 | 缺标题、标题 >60、截断标题重复为 error；描述缺失或不在 60–160、OG 缺失或宽 <1000/比例不在 1.2–2.6、重复描述为 warn；OG 尺寸未知和排除变体为 info。 |
| `orchestrator/src/seo/gates/canonical-target.ts:68` `titleSimilarity()` / `runCanonicalTargetGate()` | 对非自指 canonical 复用已知 HTML 或抓目标；标题按词集合 Jaccard，相似度默认阈值 0.2，CJK 长标题改用字符二元组。 | 目标非 200、目标 noindex、canonical 链为 error；相似度低于阈值且源页非 noindex 为 warn；跨 origin 为 info。缺/自指 canonical 在此 gate 跳过，缺失另由页面审计记录。 |
| `orchestrator/src/seo/gates/retraction-sweep.ts:18` `findTerm()` / `sweepHtml()` / `runRetractionSweep()` / `fetchRetractionSweep()` | 词条去空白、去重后在可见正文、title/description、JSON-LD、FAQ、社交 meta、发现文件中不区分大小写找残留。 | 无有效词、任意残留、任意输入 URL 抓不到都为 error；全部抓到且零命中才是 `ok=true`。整站报告只将已抓 HTML 送进纯扫描，不补扫发现文件。 |
| `orchestrator/src/seo/gates/structured-data.ts:71` `extractJsonLd()` / `checkStructuredData()` / `runStructuredDataGate()` | 解析 JSON-LD 数组和 `@graph`，继承 context；按类型字段表校验 Product、Article、FAQ、面包屑、JobPosting 等。 | JSON 非法、必填字段缺失为 error；缺 schema.org context、推荐字段、HowTo 下线提示为 warn；没有 JSON-LD、受限 FAQ 类型为 info。零块仍可 `ok=true`。 |
| `orchestrator/src/seo/gates/hreflang-cluster.ts:10` `isValidHreflang()` / `extractHreflangLinks()` / `checkHreflangCluster()` / `runHreflangCluster()` | 校验语言码，种子页抓后逐一抓关联目标，检查目标状态、回指、canonical 和 html lang。 | 非法码、同码多目标、目标跳转/非 200、目标 canonical 错指、缺回指为 error；目标语言不符为 warn。种子非 200 跳过，未抓的目标也跳过；要结合 `checkedPages/fetched` 看覆盖。 |
| `orchestrator/src/seo/gates/geo-citability.ts:74` `checkGeoCitability()` / `runGeoCitabilityGate()` | 从 main/article/body 取内容，按九个信号计分；只把 `observable=true` 项放入分母，四舍五入到 0–100，整批取平均。 | 此门没有布尔 `ok` 或 error；零分项生成 warn，部分得分项生成 info。分数低只是可引用性指标，不等于 AI 未引用。 |
| `orchestrator/src/seo/gates/index.ts:1` 导出表 | 聚合 gate 导出；`SEO_GATE_IDS` 常量只列七个早期 gate id。 | 新增的 structured-data、hreflang、geo 虽导出，却不在该常量和整站七层里。 |

**页面审计的逐项阈值补充。** `auditPageHtml()` 中，title 缺失=error，长度 <10 或 >60=warn；description 缺失或长度 <50/>160=warn；H1 缺失=error、多于一个=warn；标题跳级/空标题、图片无 alt 或 alt 等于文件名=warn；html lang 缺失=error；canonical 缺失/非绝对地址=warn；noindex=info；存在 hreflang 时缺 `x-default`/自指=warn；替换字符和 HTML/HTTP charset 冲突=error，双方都不声明 charset=warn。`empty alt` 会计数，但不会单独产生 finding。位置：`orchestrator/src/seo/page-audit.ts:41,141`。

## 14. 客户审计脚本：逐文件逻辑与结果判定

这一层多为“生成事实并落盘”的脚本。除交付扫描门外，大多数脚本不输出统一 `ok`，而是把分子、分母、缺测或错误记录给评分器/报告生成器。不要用“脚本退出 0”代替 SEO 检查项通过。

| 文件与主要方法/主流程 | 实现逻辑 | 判定与边界 |
|---|---|---|
| `skills/seo-audit/scripts/_cfg.py:6` `load()`、`key()`、`locale_of()`、`strip_locale()`、`page_type()`、`html_file()` | 把配置 origin 规范为 host/domain，按 URL 首段映射语种、去目录后按正则判页型，为 gzip HTML 生成稳定文件名。 | 缺 API key 时退出；语种目录不匹配时退回默认语种，页型无匹配时为“栏目与其他页”；不判 SEO 好坏。 |
| `skills/seo-audit/scripts/crawl.py:29` `get()`、`norm()`、`crawlable()`、`extract()`、`fetch()`、`sitemap_urls()` | `get()` 超时重试；`norm()` 只保同站 URL；`extract()` 拆 200 HTML 的元数据与出链并写 gzip；主流程 BFS 后递归发现 sitemap 并补抓。 | HTTP/网络失败写 status/err；非 200 HTML 不抽内容。被 robots、扩展名或 skip_paths 排除的不抓。`source=sitemap-only` 是“内链遍历未到达”的事实，不等于绝对无入链。 |
| `skills/seo-audit/scripts/analyze.py:26` `title_px()`、`detect()`、`lang_valid()`、`soup()` 及主流程 | 从已落盘 HTML 生成 `analysis.json`：语种、语言、hreflang、页面规范、主词、图谱、宣称来源。 | title 超 600 像素、lang 无效/错语种、正文语言不符、重点页缺主词、入链 0/1 等分别以计数或比例输出。少于 200 字正文 `detect()` 返回未判定；无页面时 PageRank 初始化会除零，不能把异常当 OK。 |
| `skills/seo-audit/scripts/kw_collect.py:13` 主流程 | 查询 Google Suggest，按 domain/noise/brand/clusters 筛词、聚合命中种子次数；`--build-only` 不重请求，只重新分类。 | 采集异常打印到 stderr 并继续；词库中 `seedHits` 是补全命中，不是搜索量；空词库也可能写盘。 |
| `skills/seo-audit/scripts/serp_rank.py:54` `pick()`、`fetch()`、`parse()` | 按市场和主题轮流选词，dry-run 估新请求；缓存原始响应，解析本站第一自然位、竞品位、纠错与 AI Overview。 | 无 API key 退出；请求错误写 `error` 且不缓存；没有本站自然结果以 `sitePos=None` 表示，不把被自动纠正后的结果直接当原词排名。 |
| `skills/seo-audit/scripts/aio_stats.py:23` 主流程 | 读取 SERP 主样本缓存，统计 AI Overview、展开引用、折叠未展开、引用本站、通用问题点名与市场/主题分布。 | 只有 error 的 overview 不计出现；只有 page_token 无 references 记“未展开”，不判“未引用”；引用本站按概览条数而非链接条数计。 |
| `skills/seo-audit/scripts/cwv_batch.py:34` `crux()`、`psi()` | 调 CrUX 真实用户 p75 和 PSI 实验室数据，抽取 LCP/INP/CLS 及主要机会，写 `cwv-batch.json`。 | CrUX 404/失败写 error，评分口径应记未测；PSI 实验室得分不替代真实用户速度分项。 |
| `skills/seo-audit/scripts/http_checks.py:16` `curl()` 及主流程 | 对不同入口最多跟六跳，抽查路径两次记录压缩、缓存头、TTFB。 | `oneHopPermanent=true` 仅当正好两次请求、首跳 301/308、终点 200 且 URL 在配置主域下。压缩通过率用 `compressed/sampleCount`；TTFB 只是抽样值。 |
| `skills/seo-audit/scripts/competitors.py:13` 主流程 | 仅抓配置竞品首页及响应/标题等元数据，输出 `competitors.json`。 | 抓不到要如实呈现；首页样本不足以支持竞品全站分数。 |
| `skills/seo-audit/scripts/ext_metrics.py:31` `num()` 及主流程 | 读第三方外链 CSV、权威度分布、AI 可见度 JSON。外链通过率 `min(1, 本站值/竞品中位数)`；AI 推荐率取市场可见度均值/100；来源覆盖取各市场 `1-missing/all` 均值。 | 缺整个文件则相应项未测；有文件但缺本站/竞品记录会退出；市场无来源总数时不参与覆盖均值。得到比例并不产生布尔 `ok`。 |
| `skills/seo-audit/scripts/geo_probe.py:27` 主流程 | 校验回答题号属于冻结题集；品牌题 B 统计 `accurate` 和错误明细，非品牌题 N 只用非记忆偏差样本算推荐率，按回答引用域名计数。 | 题号无效或“判不准确却无 errors 明细”直接退出；无 B 样本准确率为 null，无干净 N 样本推荐率为 null（未测）。 |
| `skills/seo-audit/scripts/zh_rules.py:22` 规则表、`text_lines()`、`mask()`、`check()` | 抽纯文本、遮蔽不应误判的片段，按中文表达规则分类 must/look。 | must 需清零，look 只提示；放行词由配置提供。 |
| `skills/seo-audit/scripts/scan_report.py:44` `hits()` 及主流程 | 扫客户 HTML 禁用名词、旧品牌、占位符、诊断模式方案词与中文文风规则，另提示排版。 | 必清零项命中一次就退出码 1；排版提示和 look 不拦。出具方名配置了却没出现也失败。 |
| `skills/seo-audit/scripts/number_gate.py:26` 主流程 | 从报告 HTML 去脚本/SVG/原始引用表，收集 `data-k` 数字账本；白名单和“与登记值同值”可追溯数字不算漏登。 | `report.number_gate=enforce` 且有任一未登记数字时退出码 1；默认 report 模式只报数，退出 0 不代表全数字有来源。 |
| `skills/seo-audit/scripts/fidelity_check.py:18` `parts()`、`diff()` 及主流程 | 对比改稿前后数字、域名多重集合、标题序列、每表行数和汉字留存率。 | 任一集合或结构变化、留存率 <0.85（默认）即退出码 1；是改稿保真门，不判 SEO。 |
| `skills/seo-audit/scripts/pro_metrics.py:21` `run()` 及主流程 | 调净化和数字门，读 claims，计算 G1/G2/G3/G4 与部分文风/结论结构指标，写 `.metrics.json`。 | G1=扫描退出 0；G2 仅 enforce 模式比较漏登数；G3 无 claims 为 null；G4 无占位符。脚本输出度量供终审，未自动给出最终 85 分裁定。 |

## 15. HTML 成稿组件：逐文件职责与门槛

| 文件与方法 | 主要实现逻辑 | 与判定的关系 |
|---|---|---|
| `skills/seo-audit/assets/g_core.py:7` `N()`、`T()`、`grade()`、`cover()` 等 | `N()` 输出 `data-k` 数字并登记账本；表格、封面、评分环与等级是纯渲染。`grade()` 将 ≥85/70/55/40 映射 A/B/C/D，否则 E。 | 评分值由报告数据层传入，组件不自行验证数据真伪。 |
| `skills/seo-audit/assets/claims.py:17` `claim()` 及检查器、`dump()` | 判定句在生成时附可执行检查函数和引用源，保存断言结果。 | 断言失败按 `on_fail` 策略处理；终审从 claims JSON 检查失败项。 |
| `skills/seo-audit/assets/report_shell.py:28` `start()`、`finish()` | 拼主题、目录、打印样式与正文；按章节名替换 `{XXXSEC}`；输出 HTML 和旁置数字账本。 | 找不到章节或残留占位符直接失败；HTML 写出本身不等于质量门通过。 |
| `skills/seo-audit/assets/themes.py:51` `root_css()`、`base.css`、`print.css` | 配色 token、基础排版和打印布局。 | 视觉组件无 SEO `ok`；需要渲染检查。 |
| `skills/seo-audit/assets/charts.py:31` `bullet()`、`hbar()`、`dumbbell()`、`bubble2x2()`、`heatgrid()`、`matrix3x3()` | 用输入数据生成纯 SVG 比较图。 | 只展示给定数字，判定来源仍是数据脚本和 rubric。 |
| `skills/seo-audit/assets/brief.py:43` `render()`、`brief.css` | 高管摘要版的短结构与问题/市场图。 | 版本展示，不改原始检查项。 |
| `skills/seo-audit/assets/annex.py:91` `render()`、`annex.css` | 技术附录：问题表、URL 清单及可导出的明细。 | `_check()` 校验输入形状；不重新判 SEO。 |
| `skills/seo-audit/assets/playbook.py:79` `gantt_svg()`、`targets_svg()`、`render()`、`playbook.css` | 方案执行版的甘特、目标、负责矩阵与工作表。 | 只在 plan 模式交付；不改变诊断现值。 |
| `skills/seo-audit/assets/audit.example.json:1` 配置模板 | 记录站点、市场、业务关键词、重点页、模式、出具方、竞品、抓取和评分依赖。 | `rubric.md` 的通过率分母和适用性依赖此配置；模板中的示例值不可当真实站点事实。 |

## 16. 存储、阈值与关键词审计接线现状

**存储有三种形态。** 内置整站审计的 HTML、逐页抓取记录和内链图在运行期内存中；`writeSiteReport()` 只持久化精简后的 `SiteReport` JSON 和同名 Markdown，默认到仓库 `.kunpeng/seo-reports/<域名>-<UTC时间>.json/.md`，CLI 可用 `--out`、MCP 可用 `outDir` 改目录。JSON 保留分层规则数、最差 20 页、部分发现等，但不含每页原始 HTML、完整边表或关键词数据。位置：`orchestrator/src/seo/report.ts:36,115,391,399`；`orchestrator/src/cli-commands/seo.ts:15`；`orchestrator/src/seo/tools.ts:504`。

客户审计 skill 的 `full/audit.json` 是配置真相源；`full/pages.jsonl`、`full/html/*.html.gz`、`full/sitemap-urls.json` 保存原始抓取；`analysis.json`、`kw-raw.jsonl`、`kw-library.json`、`serp-raw/<市场>/*.json`、`serp-rank.json`、`aio-stats.json`、`cwv-batch.json`、`http-checks.json`、`ext-metrics.json`、`geo-probe.json` 保存各层派生数据。报告旁的 `.ledger.json` 追踪数字，`full/claims.json` 追踪判定句。它们按单次审计工作目录保存，没有统一的 SEO 数据库或自动合并为内置 `SiteReport`。位置：`skills/seo-audit/SKILL.md:29,50`；`skills/seo-audit/scripts/crawl.py:72,115,152`；`skills/seo-audit/scripts/kw_collect.py:18,51`；`skills/seo-audit/scripts/serp_rank.py:72,127`；`skills/seo-audit/assets/report_shell.py:47`。

AI 爬虫访问日志是另一路数据：日志 drain 解析后将识别到的 bot、site、UA、path、status、时间写入 Neon 的 `ai_crawler_hits`；`seo_ai_crawler_report` 读取该表汇总。GSC 工具直接查询 Google API，不将查询结果自动写入整站报告或本地资料库。位置：`orchestrator/src/server/crawler/collector.ts:54`；`orchestrator/src/server/crawler/store.ts:10,27`；`orchestrator/src/seo/ai-crawler-report.ts:28`；`orchestrator/src/seo/gsc.ts:63`。

**内置整站七层的硬阈值/严重性。** 同一行可能同时产生多条 finding；“层 OK”只要求 error=0。

| 检查项 | 当前阈值或条件 | 结果 |
|---|---|---|
| 抓取范围 | `buildSiteReport` 默认最多 300 页、并发 6；`crawlSite` 默认深度 10、遵守 robots。同源 HTML 才进入页面检查。 | 范围限制本身不触发失败，也没有最低覆盖率门。`orchestrator/src/seo/report.ts:115` |
| robots | `*` 组封 `/`；搜索/用户类 bot 默认要求可访问；训练类默认 `any`；默认要求 Sitemap 声明。 | 封全站、要求放行的 bot 被 blocked、robots 非 200/404 为 error；训练策略偏差或缺 Sitemap 为 warn；robots 404 为 warn。`orchestrator/src/seo/gates/robots-classes.ts:182,273` |
| 发现层 | 默认探测最多 200 条；发现 URL 必须为 2xx。外域默认跳过。 | 发现 URL 非 2xx 为 error；入口不可读、零候选为 warn；`llms.txt` 404 为 info。`orchestrator/src/seo/gates/discovery-liveness.ts:108` |
| sitemap/内链 | 默认深度上限 3；sitemap 非空；sitemap 中非起始 URL 至少有 1 条入链。 | 空 sitemap、未豁免孤儿页为 error；抓到未列 sitemap、深度 >3 为 warn。图谱断链未并入该层 finding。`orchestrator/src/seo/gates/sitemap-orphan.ts:27` |
| title | 必须非空；页面审计建议 10–60 字；SERP 门标题上限 60 字。 | 缺 title 是 error；页面审计的短/长 title 为 warn；SERP 门 >60 或截断后重复 title 为 error。两个门可重复计数。`orchestrator/src/seo/page-audit.ts:141`；`orchestrator/src/seo/gates/serp-budget.ts:80` |
| description | 页面审计建议 50–160 字；SERP 门建议 60–160 字。 | 缺失、过短、过长均为 warn，故单独这些问题不使总灯变红。`orchestrator/src/seo/page-audit.ts:141`；`orchestrator/src/seo/gates/serp-budget.ts:80` |
| H1/heading | 至少一个 H1；多于一个、标题空白、层级一次跳过 1 级。 | 缺 H1 为 error；其他为 warn。`orchestrator/src/seo/page-audit.ts:150` |
| 图片 | `img` 无 alt；alt 与文件名同义；SERP OG 图宽至少 1000px、宽高比 1.2–2.6。 | 均为 warn；OG 尺寸未知为 info；空 alt 只计数、不单独报错。`orchestrator/src/seo/page-audit.ts:93,162`；`orchestrator/src/seo/gates/serp-budget.ts:157` |
| lang/编码 | html lang 非空；不能有 U+FFFD 替换字符；HTTP/meta charset 若同时给出必须相同。 | 缺 lang、乱码、编码冲突为 error；双方都无 charset 为 warn。`orchestrator/src/seo/page-audit.ts:174` |
| canonical | 页面声明最好存在且是绝对 HTTP(S)；非自指目标需返回 200、可索引、不再转指；源/目标标题 Jaccard 相似度默认至少 0.2。 | 缺/相对 canonical、标题不相似为 warn；目标非 200、noindex、成链为 error；跨 origin 为 info。`orchestrator/src/seo/page-audit.ts:175`；`orchestrator/src/seo/gates/canonical-target.ts:77` |
| 首个 HTML | 可见正文默认至少 150 词。 | 低于 150 为 error；`noscript` 要求 JS 或空应用根为 warn。整站报告不给期望文本；单页工具可给 text/regex/selector，缺失为 error。`orchestrator/src/seo/gates/first-html.ts:35,114` |

**独立工具的检查门槛。** 这些不进入 `seo-mcp report` 的七层总灯：结构化数据的非法 JSON/缺必填字段为 error，缺推荐字段为 warn，无 JSON-LD 仅 info；hreflang 的非法码、同码多 URL、目标跳转/非 200、缺回指或 canonical 错指为 error，目标语言不符为 warn；撤稿词有残留或 URL 无法验证为 error；GEO 可引用度按九项可观测信号计分，缺满分项产生 warn/info，**没有布尔 OK 阈值**。位置：`orchestrator/src/seo/gates/structured-data.ts:167`；`orchestrator/src/seo/gates/hreflang-cluster.ts:55`；`orchestrator/src/seo/gates/retraction-sweep.ts:114,160`；`orchestrator/src/seo/gates/geo-citability.ts:106,138`。

**关键词审计不是完全没有实现，而是没有接入内置整站入口。** `seo-mcp report` 的 `buildSiteReport()` 固定构建 robots、发现层、sitemap、页面、SERP 页面摘要、canonical、首 HTML 七层；其参数没有市场、种子词、主词映射、API 凭据或 Search Console 数据，也不调用 `kw_collect.py`/`serp_rank.py`。`seo_serp_budget` 只检查 HTML 标题、描述、OG 图，名称里的 SERP 指“搜索结果展示预算”，不查询实际排名。当前源码未显示做此拆分的设计决定，以上是由调用关系得出的接线结论。位置：`orchestrator/src/seo/report.ts:15,115,177`；`orchestrator/src/seo/gates/serp-budget.ts:80`；`orchestrator/src/seo/tools.ts:412`。

客户审计 skill 已有关键词链：Google Suggest 按市场 `gl/hl` 采集、按配置业务词/噪声词/主题分类（`kw-raw.jsonl` → `kw-library.json`）；SerpApi 按主题轮流选词、默认每市场 14 个词、先 dry-run 估请求额度，缓存实查 JSON，再记录本站自然排名、落地语种、自动纠错（`serp-rank.json`）；`analyze.py` 对配置 `key_pages` 的标题/首段主词做正则匹配；评分契约给“关键词覆盖”15/100 权重。自动补全命中次数不是搜索量，Google 第一页自然结果数也不固定。位置：`skills/seo-audit/scripts/kw_collect.py:13,18,36`；`skills/seo-audit/scripts/serp_rank.py:25,54,104,127`；`skills/seo-audit/scripts/analyze.py:116`；`skills/seo-audit/references/rubric.md:23,40`。

要把关键词审计并入内置报告，需要先明确市场/语种、种子词与主词的输入契约，选择 GSC 或实查排名的数据源及费用/凭据边界，定义“无授权、无样本、查询被纠正”时的未测状态，再将词库、排名和重点页匹配接到 `SiteReport` 的新层、持久化逐词证据及对应测试。按本项目 C11，这会是鲲鹏功能改动，必须走自建开发循环。当前本文只描述已有实现，没有修改功能代码。

## 17. 各配置源 JSON 的结构与数据契约

**先分清四类文件。** `full/audit.json` 是一次客户审计的人写主配置，仓库只提供 `audit.example.json` 模板；`full/external/*.json`、`full/geo/*.json` 是外部平台或人工采集的输入；`full/*.json`/`*.jsonl` 多数是脚本生成的事实或汇总；内置 `kunpeng seo report` 生成的 `.kunpeng/seo-reports/*.json` 则属于另一条实现链。两条链没有共用一个 JSON Schema 或自动同步。`_cfg.load()` 只解析 JSON 并从 `origin` 派生 `_dir/_origin/_host/_domain`，没有集中式字段校验；下表的“必需”是按实际消费代码判断，不能理解为已有 schema 验证。位置：`skills/seo-audit/assets/audit.example.json:1`；`skills/seo-audit/scripts/_cfg.py:6`；`orchestrator/src/seo/report.ts:36`。

### 17.1 主配置 `full/audit.json`

模板顶部 `_说明` 等下划线键是给人看的注释，JSON 解析器仍会保留这些键；运行时派生的 `_dir/_origin/_host/_domain` 由 `_cfg.load()` 注入内存，不必写入文件。正则是 JSON 字符串，反斜杠要写两次，例如词边界写 `\\b`。配置里的站点、竞品和日期都是示例，复制时必须换成真实审计对象。位置：`skills/seo-audit/assets/audit.example.json:1,17,29`；`skills/seo-audit/scripts/_cfg.py:6`。

| 顶层字段 | JSON 结构与含义 | 实际读取与缺省/失败 |
|---|---|---|
| `origin` | 站点绝对起点 URL，字符串，如 `https://www.example.com`。 | `load()` 直接索引；缺失抛异常。派生主机名和根域，用于同站抓取及报告。`skills/seo-audit/scripts/_cfg.py:6` |
| `site_name`, `client` | 客户展示名字符串。 | 竞品首页比较以 `site_name` 为本站键，缺失退回根域；`client` 主要供报告内容。`skills/seo-audit/scripts/competitors.py:15` |
| `issuer` | `{name,monitor_label,former_names:[字符串]}`：出具方、第三方数据统称、须清零的旧称。 | 成稿扫描用 `name/former_names`；未配置时按空对象处理。`skills/seo-audit/scripts/scan_report.py:35` |
| `report` | `{mode,editions,rid,date,slug,banned_terms,allow_terms,number_gate,number_whitelist}`。`mode` 为 `diagnosis` 或 `plan`；`editions` 是 `brief/audit/playbook/annex` 的交付选择；`number_gate` 为 `enforce` 或 `report`。 | 扫描脚本读取模式、禁用词和放行词；数字门读取 `number_gate/number_whitelist`。缺模式按诊断；只有 `enforce` 才让漏登记数字成为硬失败。`skills/seo-audit/assets/audit.example.json:8`；`skills/seo-audit/scripts/scan_report.py:37`；`skills/seo-audit/scripts/number_gate.py:25` |
| `external` | `{pulled:日期,peers:[竞品根域],low_authority_max:数字}`。`peers` 必须与外链 CSV 中的域名键对应。 | 有 `backlinks.csv` 时 `peers` 缺失、本站或竞品缺行都会退出；`low_authority_max` 默认 2。`skills/seo-audit/scripts/ext_metrics.py:34,51` |
| `locales` | 语种代码为键；值 `{dir,lang,gl,hl,google_domain,label}`。`dir:""` 表示默认站点目录；`lang` 是 HTML 预期语言；只参与实查的市场需要 `gl/hl/google_domain`。 | 路径首段匹配 `dir`，不匹配退回默认语种；SERP 仅选有 `gl` 的语种，但所选项缺 `hl/google_domain` 会直接报错。`skills/seo-audit/scripts/_cfg.py:28`；`skills/seo-audit/scripts/serp_rank.py:33` |
| `brand`, `brand_terms` | `brand` 为品牌正则；`brand_terms` 为语种到品牌词数组的映射。 | `brand` 由词库和 AIO 脚本直接使用，缺失/非法正则报错；`brand_terms` 可缺，额外品牌词会并入词库，`source` 记 `brand_terms`。`skills/seo-audit/scripts/kw_collect.py:33,41`；`skills/seo-audit/scripts/aio_stats.py:20` |
| `seeds`, `seed_alphabet` | `seeds:{语种:[自动补全种子词]}`；`seed_alphabet:{语种:前缀}`。 | 采词脚本直接读取 `seeds`；有前缀时追加前 12 个字母的前缀查询。种子缺失会报错，单个语种无词可为空数组。`skills/seo-audit/scripts/kw_collect.py:19` |
| `domain`, `noise` | 业务相关性正则、排除噪声正则。 | 非品牌词须命中 `domain` 才保留；命中 `noise` 则剔除。`domain` 必需；`noise` 可为空。`skills/seo-audit/scripts/kw_collect.py:33` |
| `clusters`, `review_clusters` | `clusters` 是有序的 `[主题名,正则]` 二元数组；`review_clusters` 是主题名数组。 | 首个命中主题生效，顺序还决定 SERP 轮选顺序；`review_clusters` 决定 AIO 评价/对比引用对照范围。`skills/seo-audit/scripts/kw_collect.py:34,47`；`skills/seo-audit/scripts/serp_rank.py:32`；`skills/seo-audit/scripts/aio_stats.py:21` |
| `serp_per_market`, `serp_exclude` | 每市场抽样词数；排除词字符串，可用 `词@语种` 限定。 | 默认每市场 14 条；排除串按逗号拆分。`skills/seo-audit/scripts/serp_rank.py:31,40` |
| `crawl` | `{max_pages,concurrency,skip_paths:[路径前缀],sitemaps:[绝对 URL]}`。 | 最大页数默认 6000、并发默认 6；非空 `sitemaps` 优先使用，否则取 robots 的 Sitemap 行，再否则试三个默认 sitemap 路径，并非三者合并；跳过路径不抓。`skills/seo-audit/scripts/crawl.py:18,55,135` |
| `page_types` | 有序 `[页型名,路径正则]` 数组；先去掉语种目录再匹配。 | 首个命中生效，全部不命中归“栏目与其他页”；可缺。`skills/seo-audit/scripts/_cfg.py:44` |
| `key_pages` | `[{url,locale,type,kw,match}]`，每项定义重点页及主词正则。 | `analyze.py` 用 `url/match` 检查标题和首段；页面未抓到记录 `missing:true`，已抓到追加 `title/inTitle/inFirstP/firstP`。`locale/type/kw` 随记录透传用于报告。`skills/seo-audit/scripts/analyze.py:116` |
| `claims`, `claim_source_hint` | `claims:{语种:最高级说法正则}`；`claim_source_hint` 是出处机构正则。 | 在正文段落查最高级词；同段有外链或命中提示词标 `sourced:true`。提示词可为空，`claims` 可缺。`skills/seo-audit/scripts/analyze.py:139` |
| `competitors` | `{展示名:首页 URL}`。 | `competitors.py` 加上本站首页逐个抓取；缺失时仅比较本站。`skills/seo-audit/scripts/competitors.py:15` |
| `http_checks`, `cwv_urls` | `http_checks:{redirect_starts:[入口 URL],samples:[抽样路径/URL]}`；`cwv_urls` 为 CWV 样本 URL 数组。 | HTTP 脚本仅跑列出的入口/样本；CWV 脚本由调用参数决定待查 URL，可由配置清单供调用方准备，不能把有清单误认为自动完成测速。`skills/seo-audit/scripts/http_checks.py:19,32`；`skills/seo-audit/scripts/cwv_batch.py:65` |

**配置关系。** `locales` 的键要与 `seeds`、`brand_terms`、`key_pages[].locale`、`claims` 对齐；`clusters` 的名称要与 `review_clusters` 对齐；`external.peers` 必须出现在 `backlinks.csv`；`key_pages[].match` 和其他正则应先验证可编译。当前代码只在执行到相应脚本时才暴露其中大部分问题。API 密钥不在该 JSON 内，脚本优先读环境变量，其次读 `~/.kunpeng/seo-keys.env`。位置：`skills/seo-audit/scripts/_cfg.py:15`；`skills/seo-audit/scripts/ext_metrics.py:38`。

### 17.2 外部采集与人工标注输入

| 文件 | 结构与字段 | 消费方式和真实性边界 |
|---|---|---|
| `full/external/authority_profile.json` | 对象，键是权威度等级的数字字符串，值是该等级引荐域名数，如 `{"0":12,"20":3}`。 | 转整数键，按 `external.low_authority_max` 计算低权威比例及 `ge20`；只有外链 CSV 存在才进入该分支。空计数总和会导致除零。`skills/seo-audit/scripts/ext_metrics.py:51` |
| `full/external/anchors_top30.json` | `{pulled,rows:[{anchor,domains,cls}]}`；`cls` 为 `brand/news/spam/generic/empty` 之一，属于人工标注。 | 采集约定文件，当前 `ext_metrics.py` 不读取，不应说它已自动影响评分。`skills/seo-audit/references/data-collection.md:145` |
| `full/external/organic_by_market.json` | `{pulled,domains:{域名:{市场库:{kw,traffic}}}}`，保留平台按市场的估算值。 | 采集约定文件；`ext_metrics.py` 不读取，报告使用时需明确“平台估算”口径。`skills/seo-audit/references/data-collection.md:146,159` |
| `full/external/ai_visibility.json` | `{pulled,markets:{市场:{visibility:{域名:0–100分},sources:{all,missing,...},topics:{...},top_gap_topic}}}`。 | 至少一个市场的 `visibility` 要含本站域名，否则退出；`recommend_rate` 为本站各市场分数均值除 100；`source_coverage` 为各有全量来源数市场的 `1-missing/all` 均值。`topics/top_gap_topic` 在当前汇总脚本中未参与计算。`skills/seo-audit/references/data-collection.md:154`；`skills/seo-audit/scripts/ext_metrics.py:60` |
| `full/geo/questions.json` | `{version,frozen,markets:{市场:{gl,hl,q:{N1:问题,B1:问题,...}}}}`。N 是无品牌推荐题，B 是品牌准确性题；版本冻结后复测沿用。 | `geo_probe.py` 检查每条回答的市场、题号在题集中存在；不校验每市场题数、问题语种或 frozen 格式。`skills/seo-audit/scripts/geo_probe.py:4,27` |
| `full/geo/facts.json` | 官方参数基准，按型号列参数并为每条附官网出处 URL；参考文档没有给出固定字段名/可机读 schema。 | 人工核对 B 题时使用；`geo_probe.py` 本身不读取此文件，仅消费 `answers.jsonl` 的 `accurate/errors`。不能把输出准确率描述成脚本自动比对官网。`skills/seo-audit/references/data-collection.md:170`；`skills/seo-audit/scripts/geo_probe.py:27` |
| `full/geo/answers.jsonl` | 每行一条 `{engine,market,qid,mentioned,recommended,rank,brands,citations,accurate,errors:[{claim,official}],memory_biased}`。`accurate` 仅 B 题有值，未知可为 `null`。 | B 题 `accurate:false` 必须有非空 `errors`；N 题 `memory_biased:true` 不进推荐率分母，但其引用仍被统计；题号不存在直接退出。`skills/seo-audit/scripts/geo_probe.py:8,30,41,44` |

`backlinks.csv` 和各市场原始导出虽不属于 JSON，却是 `ext-metrics.json` 的必要上游：前者必须是分号分隔，含 `target/ascore/domains_num/backlinks_num/follows_num` 列。缺本站、任一配置竞品或必需列不能形成有效外链对照。位置：`skills/seo-audit/scripts/ext_metrics.py:34`。

### 17.3 抓取、关键词、排名和性能生成文件

| 文件 | 外层/单条记录结构 | 产生者与判读要点 |
|---|---|---|
| `full/pages.jsonl` | 一行一页；基础字段 `{url,final,status,secs,bytes,ctype,source,depth}`，失败可能有 `err`。仅 200 HTML 追加 `title/desc/robots/ogImage/canonical/lang/hreflang:[[语种,URL]]/h1/jsonld:[类型]/img:{total,noAlt,lazy,modern,noDims}/scripts/thirdPartyScripts/words/outlinks:[URL]`。 | 抓取脚本逐页落盘；非 200/非 HTML 没有内容字段，消费端要按状态过滤。原 HTML 单独在 `full/html/*.html.gz`。`skills/seo-audit/scripts/crawl.py:72,115` |
| `full/sitemap-urls.json` | URL 字符串数组。 | sitemap 遍历结果，供与内链到达性对照；它不是页对象数组。`skills/seo-audit/scripts/crawl.py:152` |
| `full/analysis.json` | 汇总对象：`_denominators,pages,statuses,sources,sitemapOnly,byLocale,lang,langBadTotal,hreflang,titles,descEmpty,descEmptyByLocale,h1,images,ogAbsolute,ogMissing,jsonld,jsonldPages,jsonldByType,noindex,keyPages,keyInTitle,keyInFirstP,keyTotal,inlinks,depth,typeRank,pagerankTop,claims,words`。 | `statuses/sources/depth` 是计数映射；`hreflang` 有 `pagesWith/pagesWithCounterpart/counterpartWith/asymmetricLinks/xDefault`；`inlinks` 有 `zero/one/median`；`claims` 有 `count/sourced/byWord/examples`。所有比例应依 `_denominators` 重新算，不从不同抓取链混分母。`skills/seo-audit/scripts/analyze.py:153` |
| `full/kw-raw.jsonl` | 每行 `{locale,seed,keyword,rank}`；rank 是自动补全返回顺序。 | Google Suggest 原始采集；网络错误可能漏样本。`skills/seo-audit/scripts/kw_collect.py:25` |
| `full/kw-library.json` | 数组，每项 `{keyword,locale,cluster,seedHits,bestRank,source}`；`source` 为 `google-suggest` 或 `brand_terms`。 | 经业务相关/噪声/主题规则聚合；`seedHits` 是命中种子数，不能当搜索量。`skills/seo-audit/scripts/kw_collect.py:33,49` |
| `full/serp-raw/<语种>/<哈希>.json` | SerpApi 原始响应，脚本重点读 `organic_results`、`search_information`、`ai_overview`；可有 `-nfpr.json` 精确查询补充文件。 | 外部响应随 API 变化，代码没有固定完整 schema；哈希由 `locale|keyword` 生成，缓存命中不重复扣本次请求数。`skills/seo-audit/scripts/serp_rank.py:72,104` |
| `full/serp-rank.json` | `{date,domain,per,spentThisRun,rows:[{locale,market,keyword,cluster,error,sitePos,siteUrl,landingLocale,pdf,organicCount,corrected,showingResultsFor,top3,domains,exact?}]}`。 | `sitePos:null` 表示该次自然结果未找到本站；`corrected:true` 表示搜索词被纠正，品牌词可补 `exact`；`error` 非空应视为请求未测。`skills/seo-audit/scripts/serp_rank.py:104,119,127` |
| `full/aio-stats.json` | `{aio,withRefs,folded,explicitNoAio,cited,citedByLocale,citedByCluster,topDomains,reviewCompare,generic,genericNamed}`；`generic` 元素为 `{locale,keyword,named}`。 | 基于 SERP 主样本原始响应；`folded` 是概览未展开引用，不是“未引用本站”；`topDomains` 是 `[域名,次数]` 数组。`skills/seo-audit/scripts/aio_stats.py:30,46` |
| `full/cwv-batch.json` | `{date,origin:{phone,desktop},pages:[{url,phone,desktop,lab}]}`；CrUX 成功项按可用指标含 `LCP/INP/CLS/TTFB`，PSI lab 含 `score/LCP/TBT/CLS/bytes/opps:[[标题,毫秒]]`；失败对象为 `{error}`。 | `origin` 是整域真实用户样本，`pages` 是 URL 样本；`error` 表示未测，不能当差分。`skills/seo-audit/scripts/cwv_batch.py:34,48,65` |
| `full/http-checks.json` | `{redirects:[{start,hops:[{url,code,to}],oneHopPermanent}],samples:[{url,try,encoding,cache,ttfb}],compressed,sampleCount}`。 | `cache` 是响应头名值对数组；`oneHopPermanent` 是脚本布尔判定，详见第 14 节；TTFB 是抽样秒数。`skills/seo-audit/scripts/http_checks.py:22,31,39` |
| `full/competitors.json` | `{展示名:{url,status,final?,ttfb?,title?,lang?,hreflang?,xdefault?,canonical?,jsonld?,encoding?,cache?,note?}}`。 | 访问失败时只有 `url/status/note`；成功时才有其余首页字段。`skills/seo-audit/scripts/competitors.py:23,32` |

### 17.4 派生评分、报告校验与内置结果

| 文件 | 结构 | 如何使用 |
|---|---|---|
| `full/ext-metrics.json` | `{domain,pulled,backlinks?,ai_visibility?}`；`backlinks` 含 `table`（每域 `authority/ref_domains/backlinks/follow/follow_share`）、竞品中位数、`checks`、可选 `authority_profile`；`ai_visibility` 含市场、分数、排名、来源覆盖、`checks`。 | 可选输入不存在时对应分支不存在，应记未测。外链 `checks` 是本站/竞品中位数并封顶 1；无竞品记录会失败。`skills/seo-audit/scripts/ext_metrics.py:28,47,67` |
| `full/geo-probe.json` | `{questions_version,accuracy:{n,ok,by_engine,errors,rate},recommend:{n_all,n_clean,mentioned,recommended,rate,by_market},citations:[[域名,次数]]}`。 | `by_engine`、`by_market` 的值都是 `[符合数,样本数]`；无 B 样本或干净 N 样本时相应 `rate:null`。准确性依据人工写入的 `accurate/errors`。`skills/seo-audit/scripts/geo_probe.py:33,44,53` |
| `full/claims.json` | 数组，每项 `{id,text,ok,why,refs:[来源]}`。 | 报告生成器 `claim()` 先运行检查再登记，失败默认抛异常；终审可据 `ok` 查失败判定句。`skills/seo-audit/assets/claims.py:17,57` |
| `<报告>.ledger.json` | `{数字键:原始数值}` 映射。 | `N(value,key)` 登记数值，同键异值立即失败；成稿时旁置落盘，数字门再从 HTML 的 `data-k` 对照未登记数字。`skills/seo-audit/assets/g_core.py:6`；`skills/seo-audit/assets/report_shell.py:73` |
| `<报告>.metrics.json` | `{gates:{G1_scan,G2_numbers,G3_claims,G4_structure},D1,D2,D3,D5,D6,chars_k}`；维度内含覆盖率、量词、结论点、文风与长度等细项。 | 门值可为 `null`（如非 enforce 的 G2、无 claims 的 G3），不是通过；该文件是交付质量度量，不是全站 SEO 审计结果。`skills/seo-audit/scripts/pro_metrics.py:52,57` |
| `.kunpeng/seo-reports/<域名>-<UTC时间>.json` | 内置 `SiteReport`：`origin/generatedAt/crawl/redirects/layers/robots/discovery/sitemap/pageAudit/serp/canonical/firstHtml/retraction?/totals`。 | `totals.ok` 对应整站七层 error 汇总；只存精简摘要，不含 `pages.jsonl`、完整边表或关键词资料。写盘时并列生成同名 Markdown。`orchestrator/src/seo/report.ts:36,399` |
| 状态目录 `crawler-sites.json` | `{站点名:[主机名片段,...]}`，例如 `{"example":["example.com"]}`。 | 只用于 AI 爬虫日志归属，不控制审计抓取；校验键非空、值为字符串数组，读不到或形状不符时退回空映射。`orchestrator/src/server/crawler/collector.ts:28,40` |

**读数规则。** 配置值表示预期和采集范围；外部采集值表示第三方/人工输入；`pages.jsonl` 和原始 SERP 表示观测；`analysis.json`、`ext-metrics.json`、`geo-probe.json` 表示计算结果；`claims/ledger/metrics` 是报告证据与交付门。遇到 `null`、`error`、缺分支或样本分母为零，必须先判“未测/不可判”，不能据此写“OK”。来源关系以各生成脚本为准，没有一套覆盖上述所有文件的集中式 JSON Schema。位置：`skills/seo-audit/scripts/_cfg.py:6`；`skills/seo-audit/scripts/geo_probe.py:40`；`skills/seo-audit/scripts/cwv_batch.py:41`。

## 18. 审计报告的竞对分析如何实现

**竞对名单有两套键。** `audit.json.competitors` 是“展示名 → 首页 URL”，用于首页实测和客户版命名；`external.peers` 是竞品根域名数组，用于外链中位数，要求与第三方 CSV 的 `target` 完全对上（读入时仅去掉 `www.`）。两者没有代码级自动映射或一致性校验；配置人员要保证同一家公司、同一域名口径。配置建议 3–5 家；同一家多域名在 `peers` 中只取一个。位置：`skills/seo-audit/assets/audit.example.json:10,58`；`skills/seo-audit/references/data-collection.md:102`；`skills/seo-audit/scripts/ext_metrics.py:34`。

| 对照维度 | 采集/计算路径 | 报告怎么用；不能推出什么 |
|---|---|---|
| 首页技术抽样 | `competitors.py` 自动把本站首页加入首行，逐个用带 40 秒超时的 `curl` 抓配置中的竞品首页；解析最终状态/URL、单次 TTFB、标题、`html lang`、hreflang 数量、`x-default`、canonical、JSON-LD 类型、压缩与缓存头，输出 `full/competitors.json`。每站独立临时文件；非 200 只写状态/原因。 | 在竞品对照节列首页现值，403 或超时照实标注。只抓首页，TTFB 是单次请求，不能代表全站技术得分或真实用户 p75。`skills/seo-audit/scripts/competitors.py:13,21,23,32`；`skills/seo-audit/references/data-collection.md:108` |
| 外链与权威度 | 同一第三方平台、同一日期、同一根域名口径导出 `external/backlinks.csv`，至少有 `target/ascore/domains_num/backlinks_num/follows_num`；`ext_metrics.py` 抽本站与 `external.peers`，计算竞品 `ascore` 和引荐域名数的 `statistics.median`。两项通过率各为 `min(1, 本站值 / 竞品中位数)`，写入 `ext-metrics.json.backlinks.checks`。 | 客户版同表展示本站、竞品和中位数；SEO“外部链接”分项权重 15，只用权威度和引荐域名两项参与该分项计算。外链数/follow 占比、低权威域名及锚文本用于说明，不直接计分。缺任一配置竞品行直接失败；没有外链数据则未测。代码没有处理中位数为 0 的除零情况。`skills/seo-audit/scripts/ext_metrics.py:34,41,45,47`；`skills/seo-audit/references/rubric.md:25,54` |
| 各国自然搜索规模 | 第三方平台的 `domain_ranks` 按每家、每市场库采集 `organic_keywords/organic_traffic`，落 `external/organic_by_market.json`，约定结构是 `{pulled,domains:{域名:{库:{kw,traffic}}}}`。 | 竞品节做“市场 × 品牌”的估算流量（关键词数）表、合计和市场第一标记。此文件没有被 `ext_metrics.py` 自动计算成 SEO 得分；平台估算只作量级横比，不能用来宣称某词的实际 Google 名次。`skills/seo-audit/references/data-collection.md:143,146,159`；`skills/seo-audit/references/report-structure.md:30` |
| 实际 Google 排名与品牌词 | `serp_rank.py` 按市场 `gl/hl/google_domain` 和主题轮选词，每市场默认 14 条；保存原始 `serp-raw` 与 `serp-rank.json`。`parse()` 提取本站第一自然位、落地语种、前 3 域名及前 10 域名；品牌词被 Google 改写可用 `nfpr` 补查。 | 竞品节的品牌词及搜索表现以实查为准。前 3/前 10 域名提供“常见竞争者”线索，但代码没有给每家竞品形成完整的逐词排名矩阵；自动纠错且未重查的品牌词记未测。`skills/seo-audit/scripts/serp_rank.py:54,72,104,119`；`skills/seo-audit/references/report-structure.md:26,30` |
| AI 可见度与来源 | 第三方平台网页端按市场读取本站与对比域名的 0–100 可见度，人工汇总 `external/ai_visibility.json`；`ext_metrics.py` 只筛出含本站的市场，输出本站分数、该市场所有域名的排序、来源页覆盖 `1 - missing/all`。 | AI 章节展示各市场本站与竞品相对位置；推荐率评分是本站各市场可见度均值/100，不是竞品分差。来源覆盖用全量来源数，不用前 100 条明细。平台不可用时记未测。`skills/seo-audit/references/data-collection.md:151,154,156`；`skills/seo-audit/scripts/ext_metrics.py:60,67` |
| 摘要图与报告组装 | 客户报告按结构规范写第 14 节“竞品对照”；高管摘要版可接收 `compare:{title,caption,rows:[(指标,本站,参照)]}` 并用哑铃图展示。报告生成器用数据层、`g_core.N()` 数字账本及 `claims.claim()` 判定句校验，再由 `report_shell.finish()` 组装。 | 这些是报告的数据契约和渲染组件；仓库没有一个固定的“竞品总分自动生成器”。同范围未采集竞品全站时不得给竞品打分。`skills/seo-audit/references/report-structure.md:30,58`；`skills/seo-audit/assets/brief.py:13,79`；`skills/seo-audit/SKILL.md:46,50` |

**一条可复核的计算示例。** 假设同口径采集的三家竞品权威度为 20、30、50，本站为 24，则中位数为 30，本站这一检查项的通过率是 `min(1,24/30)=0.8`；若本站为 45，则封顶为 1。引荐域名数独立重复同一公式。真正的 SEO 外链分项如何把两项通过率换算为 15 分，须依 `rubric.md` 的分项规则并保留原始表、采集日期和口径。位置：`skills/seo-audit/scripts/ext_metrics.py:45`；`skills/seo-audit/references/rubric.md:25`。

**与内置整站报告的边界。** `orchestrator/src/seo/report.ts` 的 `SiteReport` 没有 `competitors` 字段，也不自动调用 `competitors.py`、第三方平台或上述竞品评分链。因此这里的“竞对分析”是客户审计 skill 在采集和成稿阶段拼装的章节，不是内置七层整站 gate 的第八层。位置：`orchestrator/src/seo/report.ts:36`；`skills/seo-audit/SKILL.md:39,46,50`。

## 19. 检查规则与正反示例

本节例子只演示**规则怎样判**，不是对某个真实网站的审计结论。示例域名均用 `example.com`。先分清：内置 gate 的“OK”一般仅表示没有 `error`，仍可有 `warn/info`；客户版是逐项通过率，缺数据为“未测”，单语站 hreflang 为“不适用”。同一类现象在两套规则里的阈值可能不同，例如内置页面 title 看 10–60 个字符，客户评分看 600 像素估算宽度。位置：`orchestrator/src/seo/report.ts:104`；`skills/seo-audit/references/rubric.md:3,18`。

### 19.1 内置整站 gate 与页面规则

| 检查项及等级 | 正确/通过示例 | 反向/不通过示例 | 实现位置 |
|---|---|---|---|
| robots 通配组、AI 搜索/用户爬虫：误封为 error | `User-agent: *` 配 `Allow: /`，搜索和用户触发类爬虫可访问首页。 | `User-agent: *` 配 `Disallow: /`，触发封站 error；单独封被默认要求放行的搜索类也为 error。 | `orchestrator/src/seo/gates/robots-classes.ts:182,207` |
| robots 训练类策略、Sitemap 声明：偏差为 warn | 策略要求训练类 block 且相应 bot 确实被封；robots 中有 `Sitemap: https://example.com/sitemap.xml`。 | 策略要求 block 却可抓，或缺 Sitemap 行：warn；没有其他 error 时 gate 仍可 `ok=true`。 | `orchestrator/src/seo/gates/robots-classes.ts:224,235` |
| robots 文件可读性：非 200/404 为 error | `/robots.txt` 返回 200；返回 404 会记 warn，但未必让层失败。 | 返回 500 或网络异常，`robots-status` error。 | `orchestrator/src/seo/gates/robots-classes.ts:256,273` |
| 发现层入口和目标存活 | 首页、robots、llms 来源可读取；从中发现的同源 URL 返回 2xx。 | `llms.txt` 404 只是 info；入口 500 是 warn；从入口发现的 sitemap 或页面返回 404/网络错误是 error。默认最多探测 200 个 URL、跳过外域。 | `orchestrator/src/seo/gates/discovery-liveness.ts:108,133,179` |
| Sitemap 有效条目与孤儿页：error | sitemap 有 URL，`/guide` 能从已抓页面的站内链接到达。 | sitemap 为空是 error；`/guide` 列在 sitemap 却没有入链是 error，除非路径命中 `allow` 豁免。 | `orchestrator/src/seo/gates/sitemap-orphan.ts:27,39` |
| Sitemap 漏列与点击深度：warn | 可抓页也列入 sitemap，首页至页面深度 ≤3。 | `/blog/a` 可由内链抓到却不在 sitemap，或深度 4：warn；无 error 时 sitemap 层仍可能 OK。 | `orchestrator/src/seo/gates/sitemap-orphan.ts:48` |
| 初始 HTML 正文：少于 150 词为 error | 服务器返回的原始 HTML 中已有至少 150 词可见正文。 | 仅 `<div id="root"></div>`，正文 0 词：`first-html-shell` error；空根另有 warn。JS 运行后才出现的正文不计。 | `orchestrator/src/seo/gates/first-html.ts:28,35,63` |
| 初始 HTML 指定内容：缺失为 error | 期望 `text:"产品参数"` 且初始 HTML 对应选择器内确有这段文字。 | 只有 `id` 或选择器虽存在但没有所需 text/regex，均判缺失 error。 | `orchestrator/src/seo/gates/first-html.ts:76` |
| 页面标题：缺失 error、字符长度 warn | `<title>Example 产品规格与购买指南</title>`，非空且 10–60 个 Unicode 字符。 | 空 `<title>` 是 error；9 字或 61 字是 warn。 | `orchestrator/src/seo/page-audit.ts:133` |
| 描述：缺失/字符长度均 warn | `meta description` 非空，长度在 50–160 字符内。 | 没有 description，或只有“欢迎访问”：warn；本规则不会单独把页面层变成 error。 | `orchestrator/src/seo/page-audit.ts:138` |
| H1 与标题层级 | 页面有一个非空 H1，接着是 H2、H3。 | 无 H1 为 error；两个 H1、H1 直接跳 H3、空 H2 分别为 warn。 | `orchestrator/src/seo/page-audit.ts:143` |
| 图片 alt | 内容图有表达内容的 `alt="红色旅行背包正面"`；装饰图显式 `alt=""` 不触发此页面 finding。 | `<img src="red-bag.jpg">` 缺 alt 为 warn；`alt="red bag"` 与文件名规范化后相同也为 warn。客户评分对空 alt 的口径另看下一表。 | `orchestrator/src/seo/page-audit.ts:83,154` |
| HTML lang | `<html lang="de">` 有非空属性。 | `<html>` 没有 lang：error；本页面规则只查非空，不核对目录与代码合法性，客户评分另核。 | `orchestrator/src/seo/page-audit.ts:160` |
| canonical 声明 | `<link rel="canonical" href="https://example.com/guide">`。 | 没有 canonical，或仅 `href="/guide"`：warn。 | `orchestrator/src/seo/page-audit.ts:161` |
| canonical 目标 | `/guide?src=x` 指向返回 200、可索引且自指的 `/guide`；标题内容相近。 | 目标 404、noindex、又指向第三个 URL：error；标题 Jaccard 相似度 <0.2：warn；跨站指向只是 info。 | `orchestrator/src/seo/gates/canonical-target.ts:77,133,140` |
| noindex | 不应索引的登录页写 `noindex`，页面审计仅记 info；需要索引的正文页不写。 | 把关键落地页写成 `noindex`，页面审计仍只是 info；但若它是 canonical 目标，会产生 error。不能把本规则的 info 解释成“索引正常”。 | `orchestrator/src/seo/page-audit.ts:166`；`orchestrator/src/seo/gates/canonical-target.ts:146` |
| hreflang 基础与集合 | 多语种页有 `x-default` 和当前页自指；目标返回 200、canonical 自指，并回链到源页。 | 缺 `x-default`/自指为页面 warn；集合中语言码非法、同码多目标、目标跳转/非 200、缺回链或目标 canonical 错指为 error；目标 HTML 语言不符为 warn。未抓到目标会跳过，须看覆盖数。 | `orchestrator/src/seo/page-audit.ts:167`；`orchestrator/src/seo/gates/hreflang-cluster.ts:55,86` |
| 编码与乱码 | HTML 与 HTTP 同声明 UTF-8，原 HTML 无替换字符 `�`。 | HTML meta 为 UTF-8、HTTP 为 ISO-8859-1 或正文出现 `�`：error；两边都没有 charset：warn。 | `orchestrator/src/seo/page-audit.ts:175` |
| SERP 标题预算与重复 | 可索引页 title ≤60 字，截断后的标题各不相同。 | 61 字或无标题是 error；两个长标题前 60 字相同会形成重复标题 error。`noindex`/canonical 变体不进此项。 | `orchestrator/src/seo/gates/serp-budget.ts:96,127,178` |
| SERP 描述与社交图 | 描述 60–160 字；`og:image` 有绝对地址，宽 ≥1000 且宽高比在 1.2–2.6。 | 描述缺失/太短/太长、重复描述、图片缺失/宽 800/比例 3.0 都是 warn；图片尺寸未知为 info。 | `orchestrator/src/seo/gates/serp-budget.ts:138,157,188` |
| 结构化数据独立工具 | JSON-LD 是合法 JSON，Product 至少有 `name` 和 `offers/review/aggregateRating` 之一，且 offer 带价格字段。 | JSON 非法、Product 缺必填字段为 error；缺 schema.org context 或推荐字段为 warn；完全没有 JSON-LD 只记 info。此工具不进整站七层总灯。 | `orchestrator/src/seo/gates/structured-data.ts:76,101,167` |
| 撤稿扫描（传 `terms` 才执行） | 词“旧品牌”在已检查 HTML 的正文、标题/描述、JSON-LD、FAQ、社交 meta 中均无命中。 | 任何上述位置残留该词，或指定页抓取失败，均为 error；整站入口只扫描其已抓 HTML。 | `orchestrator/src/seo/gates/retraction-sweep.ts:51,101`；`orchestrator/src/seo/report.ts:174` |

### 19.2 客户报告 SEO 评分项

以下每行是 `rubric.md` 的检查项；示例中的“通过”表示该样本进分子，“反向”表示不进分子。分母、未测和不适用要随报告展示。评分公式为“分项权重 × 该分项已测检查项通过率的平均值”，总分再按已测权重归一。位置：`skills/seo-audit/references/rubric.md:3,18`。

| 分项/检查规则 | 通过样本 | 反向样本或未测 | 数据依据 |
|---|---|---|---|
| 技术：搜索类爬虫可访问 | 搜索类 bot 按 robots 规则能抓首页。 | Google/AI 搜索类被 `Disallow: /` 误封；按搜索类爬虫数计通过率。 | `skills/seo-audit/references/rubric.md:20`；`orchestrator/src/seo/gates/robots-classes.ts:213` |
| 技术：发现入口可达 | robots 与 sitemap 能正常读取。 | sitemap 404/无法读取，该入口不通过；不要把 `llms.txt` 404 与必须入口混为一谈。 | `skills/seo-audit/references/rubric.md:20` |
| 技术：各语种首页 canonical 自指 | `/de` 的 canonical 是 `https://example.com/de`。 | `/de` 指向英文首页 `/`，该语种首页不通过。 | `skills/seo-audit/references/rubric.md:20` |
| 技术：lang 合法且与目录一致 | `/de/guide` 的 `<html lang="de">`。 | `/de/guide` 写 `lang="en"` 或非法代码；按语种目录页面计。 | `skills/seo-audit/references/rubric.md:20`；`skills/seo-audit/scripts/analyze.py:58,81` |
| 技术：hreflang 覆盖 | 有德语对应版本的英文页配置了互相对应的 hreflang。 | 有对应版却没有 hreflang；单语站不适用，不计 0 分。 | `skills/seo-audit/references/rubric.md:20`；`skills/seo-audit/scripts/analyze.py:91` |
| 技术：主域跳转 | `http://example.com/` 一跳 301 或 308 到 `https://www.example.com/`，最终 200。 | 302、多跳或终点非主域/非 200 不通过。 | `skills/seo-audit/scripts/http_checks.py:22,29` |
| 技术：sitemap 清洁 | sitemap 只列可索引的正式内容页。 | 含 `/account`、测试页、作者页或 `noindex` 页不通过。 | `skills/seo-audit/references/rubric.md:20` |
| 页面规范：重点页标题含主词 | 配置 `key_pages[].match` 为 `china travel`，标题包含完整词形。 | 标题只有无关主题；正则未命中。重点页未抓到应保留 `missing` 证据。 | `skills/seo-audit/scripts/analyze.py:116`；`skills/seo-audit/references/rubric.md:43` |
| 页面规范：标题宽度 | 估算/测得 580px，≤600px。 | 650px，不通过；这是像素口径，不是内置 gate 的 60 字。 | `skills/seo-audit/scripts/analyze.py:26,109` |
| 页面规范：description | 页面 description 有实际内容。 | 空或缺失，不通过；客户评分未要求内置页面审计的 50–160 字。 | `skills/seo-audit/references/rubric.md:21`；`skills/seo-audit/scripts/analyze.py:161` |
| 页面规范：H1 | 页面至少一个 H1。 | 没有 H1 不通过；多个 H1 在内置页面审计另记 warn。 | `skills/seo-audit/references/rubric.md:21`；`skills/seo-audit/scripts/analyze.py:163` |
| 页面规范：图片 alt | 内容图片有描述性 alt，如“红色旅行背包正面”。 | 内容图没有 alt 或空 alt，进缺 alt 计数；该评分项以图片为分母。 | `skills/seo-audit/references/rubric.md:21`；`skills/seo-audit/scripts/crawl.py:99` |
| 页面规范：OG 图片绝对地址 | `og:image=https://example.com/card.jpg`。 | `og:image=/card.jpg` 或缺失不通过。 | `skills/seo-audit/scripts/analyze.py:164` |
| 内容：正文语言 | `/de/guide` 正文主要为德语且可判定。 | 大段英文正文放在德语目录不通过；正文少于 200 字符时语言识别返回未判定，不应硬写“语言正确”。 | `skills/seo-audit/scripts/analyze.py:44,81` |
| 内容：对比需求承接 | 词库有“产品 A vs B”，站内有对应可访问的对比页。 | 用户有对比需求，站内没有承接页。此项需根据词库和页面事实判定，不是自动见词即通过。 | `skills/seo-audit/references/rubric.md:22`；`skills/seo-audit/scripts/kw_collect.py:47` |
| 内容：评价需求承接 | 词库有“品牌 review”，站内有相应评价/口碑内容页。 | 只有产品销售页，没有评价问题的承接内容。 | `skills/seo-audit/references/rubric.md:22` |
| 内容：最高级说法有出处 | “最快”所在段落有指向外部依据的链接，或命中配置的可信来源提示。 | “行业第一”同段无来源，`sourced:false`；按宣称条数计。 | `skills/seo-audit/scripts/analyze.py:139,151` |
| 关键词：实查词进第一页 | 某市场实查词的本站自然位为 6。 | 无本站自然结果或位次在第一页之外；请求报错则未测。第一页的自然条数按实查响应，不凭固定 10 条臆定。 | `skills/seo-audit/scripts/serp_rank.py:104,119`；`skills/seo-audit/references/rubric.md:23` |
| 关键词：品牌/型号词进第一页 | 原拼写“Example X1”实查本站位于第一页。 | 没出现；若 Google 改写了品牌词且没按原拼写补查，该词记未测。 | `skills/seo-audit/scripts/serp_rank.py:114,123`；`skills/seo-audit/references/rubric.md:23` |
| 关键词：落地语种 | 德国市场进第一页的官网结果落到 `/de/...`。 | 德国市场落到英文页 `/en/...`；PDF/静态资源从分母剔除，零个第一页结果则未测。 | `skills/seo-audit/scripts/serp_rank.py:110,129`；`skills/seo-audit/references/rubric.md:23` |
| 关键词：重点页首段含主词 | `/de` 首段与配置的 `match` 正则相符。 | 主词只出现在页脚、不在首段；不通过。 | `skills/seo-audit/scripts/analyze.py:116` |
| 内链：内容页有站内入口 | `/guide` 可从导航或另一内容页链接到达。 | 只能从 sitemap 发现，`source=sitemap-only`，不通过。 | `skills/seo-audit/scripts/crawl.py:152`；`skills/seo-audit/references/rubric.md:24` |
| 内链：产品页 PageRank 位次 | 共 100 页，产品页中位位次 20：通过率 `1−20/100=0.8`。 | 中位位次 80：通过率 0.2；这是连续评分，不是单页“OK/不 OK”。 | `skills/seo-audit/scripts/analyze.py:124,171`；`skills/seo-audit/references/rubric.md:24` |
| 内链：至少两条入链 | 页面有 2 条及以上其他站内页指向它。 | 入链 0 或 1 不通过；首页和重复同源链接的口径按图谱去重后计算。 | `skills/seo-audit/scripts/analyze.py:125,169` |
| 外链：权威度与引荐域名 | 本站权威度 40，竞品中位 30：该项封顶 1；引荐域名另算。 | 本站 15、中位 30：该项 0.5；没同口径竞品平台数据则未测。 | `skills/seo-audit/scripts/ext_metrics.py:34,45` |
| 速度：手机 LCP p75 | ≤2.5 秒满分。 | ≥4 秒零分；2.5–4 秒线性插值。CrUX 无样本记未测，不拿 PSI lab 替代。 | `skills/seo-audit/references/rubric.md:26`；`skills/seo-audit/scripts/cwv_batch.py:34` |
| 速度：手机 INP p75 | 180ms，满足 ≤200ms。 | 250ms 不满足；无 CrUX 样本未测。 | `skills/seo-audit/references/rubric.md:26` |
| 速度：桌面 CLS p75 | ≤0.1 满分。 | ≥0.25 零分；中间线性插值。 | `skills/seo-audit/references/rubric.md:26` |
| 速度：首页 LCP 达标占比 | 4 个有真实用户数据的首页里 3 个 LCP ≤2.5 秒，通过率 3/4。 | 4 个里只有 1 个达标，为 1/4；无真实用户样本的首页不硬算失败。 | `skills/seo-audit/references/rubric.md:26` |
| 速度：HTML 压缩 | 抽查 10 次有 9 次 `Content-Encoding`，通过率 9/10。 | 10 次仅 2 次有压缩，通过率 2/10；真实用户速度全缺时，不能只靠这一项把整个速度分项算满。 | `skills/seo-audit/scripts/http_checks.py:31,39`；`skills/seo-audit/references/rubric.md:3,26` |

### 19.3 客户报告 GEO 评分项

GEO 的评分项与内置 `seo_geo_citability` 启发式分数是两套口径；后者没有并入整站总灯。下表的 AI 表现需要实际采样或第三方数据，页面结构“看起来可引用”不能代替“已被引用”。位置：`skills/seo-audit/references/rubric.md:28`；`orchestrator/src/seo/gates/geo-citability.ts:74`。

| 检查规则 | 通过样本 | 反向样本或未测 | 数据依据 |
|---|---|---|---|
| AI 爬虫可达：robots 放行 | 配置列出的主要 AI 搜索/用户爬虫按 robots 可抓。 | 被 robots 封锁；训练类 bot 是否允许受策略影响，不能笼统写“所有 AI bot 必须放行”。 | `skills/seo-audit/references/rubric.md:30`；`orchestrator/src/seo/gates/robots-classes.ts:213` |
| AI 爬虫可达：原始 HTML 有正文 | 未执行 JS 的 HTML 中已有可读产品/服务内容。 | 仅空应用根，正文需 JS 才出现；内置首屏门默认少于 150 词记 error。 | `skills/seo-audit/references/rubric.md:30`；`orchestrator/src/seo/gates/first-html.ts:35` |
| 可引用性：描述、语言、出处、问答承接 | 描述非空、德语页正文是德语、统计/最高级说法有出处，并有回答评价或对比问题的页面。 | 描述空、语种错、绝对化说法无来源或用户问题无承接页；四项按各自分母计，不是“有一项好就全通过”。 | `skills/seo-audit/references/rubric.md:31` |
| AI 概览引用率 | 10 条带引用列表的 Google AI 概览中 4 条引用本站，通过率 4/10。 | 10 条仅 1 条引用，为 1/10；只有折叠未展开引用的概览不当作“确定未引用”。 | `skills/seo-audit/scripts/aio_stats.py:33,40,45`；`skills/seo-audit/references/rubric.md:32` |
| 通用问题点名率 | 10 条不含品牌/品牌化技术词的问题中，4 条 AI 概览正文提到品牌，为 4/10。 | 10 条仅 1 条提到，为 1/10；样本很小要在报告说明，不得把品牌词查询算通用问题。 | `skills/seo-audit/scripts/aio_stats.py:38,46`；`skills/seo-audit/references/rubric.md:33` |
| AI 推荐率 | 平台两市场本站可见度 60 和 40，平均/100 为 0.5；无平台数据时可用干净网页实测 5/10。 | 自家登录账号的带记忆样本即使推荐也不计分；平台和干净实测都没有则未测。 | `skills/seo-audit/scripts/ext_metrics.py:67,72`；`skills/seo-audit/scripts/geo_probe.py:44` |
| 来源页覆盖 | 某市场全部 100 个引用来源中 `missing=20`，覆盖率 `1−20/100=0.8`。 | `missing=80` 则 0.2；只有前 100 条来源明细、没有全量 `all/missing` 时不能套用公式。 | `skills/seo-audit/scripts/ext_metrics.py:65,66`；`skills/seo-audit/references/rubric.md:35` |
| AI 介绍准确 | 10 条品牌题回答与官方参数相比有 8 条无参数性错误，准确率 8/10。 | 2 条说错质保或功率则不通过，并要填 `errors:[{claim,official}]`；官方没有记载的参数不计错。无品牌题实测记未测。 | `skills/seo-audit/scripts/geo_probe.py:33,41`；`skills/seo-audit/references/rubric.md:36` |

**评分时的边界例子。** 若某分项有 5 个检查项，只有 1 项有数据，即使这项 100% 通过，整个分项仍记未测；若已测 3 项才满足“至少两项且不少于一半”的条件。单项 GEO 分项按有无数据计。缺数据不是反向示例中的“0 分”，不适用也不算进分母。位置：`skills/seo-audit/references/rubric.md:3`。

### 19.4 独立 `seo_geo_citability` 的九个内容信号

这个工具按**可观测项得分/可观测项满分**算 0–100 分，不返回布尔 OK；零分项发 warn，部分得分发 info。它是可引用性启发式，不能据此声称 AI 已推荐或引用。位置：`orchestrator/src/seo/gates/geo-citability.ts:74,106,137`。

| 信号（满分） | 满分示例 | 反向示例/实际判法 |
|---|---|---|
| 回答优先（9） | 第一段可见 `<p>` 为 20–120 词，先直接回答问题。 | 无段落或 <20 词得 0；>120 词得 4。 |
| 问句标题（7） | 至少一半 H2/H3 是“如何…？”等问句。 | 有标题但没有问句得 0；没有 H2/H3 时此项不可观测，不进分母。 |
| 数据与出处（7） | 正文有数字加 `%/万/亿/倍` 等统计信号，且有外站链接。 | 有统计无外链得 3；无统计得 0。它只查信号，不验证统计真实性。 |
| 引语（4） | 有 `<blockquote>` 或 `<q>`。 | 完全没有得 0。 |
| 更新日期（6） | JSON-LD、文章 meta 或 `<time datetime>` 有可解析日期，且距审计时间不超过 365 天。 | 有旧日期得 3；没有可解析日期得 0。 |
| 作者（6） | 有作者名称，且作者对象有 URL/sameAs 或作者链接有 href。 | 只有姓名得 3；无姓名且无作者链接得 0。 |
| 服务端正文（5） | 首次 HTML 可见内容 ≥150 词。 | 50–149 词得 2；<50 词得 0。 |
| 结构化数据（4） | JSON-LD 有类型，且类型属于 Article/Product/FAQPage 等内容类型。 | 有其他类型得 2；没有类型得 0；这不替代结构化数据工具的字段合法性校验。 |
| 可抽取结构（4） | 正文中有至少 3 个列表项的列表，或至少 2 行的表格。 | 只有普通长段落得 0。 |

实现位置：`orchestrator/src/seo/gates/geo-citability.ts:38,56,83,106,137`。
