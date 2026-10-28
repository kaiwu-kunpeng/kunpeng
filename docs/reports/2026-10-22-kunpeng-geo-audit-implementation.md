# 鲲鹏 GEO 审计实现逻辑与规则

> 依据本目录源码与验收测试静态核对，2026-10-22。本文描述实现口径，不代表已对某个真实站点完成审计。路径均相对仓库根目录。

## 1. 先分清三条链

鲲鹏目前有三条相关但相互独立的 GEO 链路，不能把其中一条的结果当成另一条的结果：

| 链路 | 入口与输入 | 输出 | 性质 |
|---|---|---|---|
| 单页可引用度 | MCP `seo_geo_citability({urls})`；逐个抓原始 HTML | `kp-geo-v1` 的逐页分数、检查项、finding，汇总平均分与抓取失败列表 | 页面结构启发式；不是实际 AI 引用率，也不是客户报告的 GEO 总分 |
| 客户版 SEO/GEO 审计 | `skills/seo-audit/SKILL.md`；`full/audit.json`、SERP 缓存、外部平台数据、冻结题集与人工/网页采样 | `aio-stats.json`、`ext-metrics.json`、`geo-probe.json`，据评分口径写成 HTML 报告 | 跨站点、跨市场的诊断工作流；数据采集和成稿并非一个自动命令 |
| GEO 监测循环 | `geo-monitor` recipe；项目 `.kunpeng/geo/config.json` 的品牌、域名、问题集 | 每波 `report-<时间>.json`、提及数指标、最多五条内容缺口任务 | 周期性问答监测；提及判定不等于客户版推荐率/准确率 |

`seo-mcp report <origin>` 只运行整站七层：robots、发现层、sitemap、页面代码、SERP 摘要预算、canonical、首个 HTML。它没有调用 `runGeoCitabilityGate()`，也不会生成 GEO 实测或 GEO 总分。证据：`orchestrator/src/seo/report.ts:115-225`、`orchestrator/src/seo/tools.ts:55-83`。

## 2. 单页可引用度：`kp-geo-v1`

调用路径：MCP `seo_geo_citability` 顺序抓取输入 URL；只把 HTTP 200 页放入评分，其他状态放入 `failed[{url,status}]`，网络异常记 `status:0`。抓取使用 `kunpeng-seo/0.1` UA 并跟随跳转；返回 `rubric/checked/averageScore/pages/failed`。每页有 `score/earned/observableMax/checks/findings`。证据：`orchestrator/src/seo/tools.ts:16,55-83`。

规则从原始 HTML 提取 JSON-LD；正文范围优先第一个 `<main>`，其次第一个 `<article>`，否则 `<body>`；先去掉导航、页眉页脚、侧栏、脚本、样式、`noscript`、模板和 SVG。实际得分如下（总上限 52，若没有 H2/H3 则该 7 分不可观测，从分母剔除）：

| 检查项 | 满分 | 精确判定 |
|---|---:|---|
| 回答优先 `answer-first` | 9 | 取正文里第一个非空 `<p>` 的词数；20–120 词得 9；超过 120 得 4；少于 20 或没有段落得 0。 |
| 问句标题 `question-headings` | 7 | 只看 H2/H3。标题以问号结尾，或以代码列出的中英文疑问词开头，算问句。分数为 `round(7 × min(1, 问句占比 ÷ 0.5))`；没有 H2/H3 时不可观测。 |
| 统计与出处 `sourced-statistics` | 7 | 正文有符合数字加 `%/percent/million/billion/万/亿/倍` 的统计，且有指向其他 hostname 的 HTTP(S) 链接，得 7；有统计无外链得 3；无统计得 0。代码只检查正文级是否同时存在，并不验证链接贴着数字或来源可信。 |
| 引语 `quotations` | 4 | 有任意 `<blockquote>` 或 `<q>` 得 4，否则 0。 |
| 更新日期 `freshness` | 6 | 从 JSON-LD `dateModified/datePublished`、文章 meta、`time[datetime]` 取可解析的最新日期；有日期得 3，与执行时刻相差不超过 365 天再得 3；无日期得 0。 |
| 作者 `authorship` | 6 | JSON-LD 作者、`meta[name=author]` 或 `a[rel~=author]` 有姓名/节点得 3；JSON-LD 作者 `url/sameAs` 或作者链接有 href 再得 3。 |
| 服务端正文 `server-rendered` | 5 | 原始 HTML 的可见词数 ≥150 得 5，50–149 得 2，低于 50 得 0；它不执行客户端 JavaScript。 |
| 结构化数据 `structured-data` | 4 | JSON-LD 有任意 `@type` 得 2；类型命中 Article、Product、FAQPage 等代码白名单再得 2。 |
| 可抽取结构 `extractable-structure` | 4 | 有至少三项的 UL/OL，或至少两行的表格，得 4，否则 0。 |

`score = round(100 × earned / observableMax)`；批量 `averageScore` 是逐页整数分数的算术平均再取整，零页返回 0。每个可观测但未满分的检查项生成 finding：0 分为 `warn`，部分得分为 `info`；没有 `error` 门。证据：`orchestrator/src/seo/gates/geo-citability.ts:8-159`。因此这个分数只表示代码定义的内容信号，不能解读成 AI 引用概率。

## 3. 客户审计的数据采集与实测

客户审计以一份 `full/audit.json` 配置站点、市场语种、品牌正则、重点页、竞品和报告模式。流程先跑整站七层及补充抓取，再算关键词、实查排名、Google AI 概览、外部平台指标，最后做多引擎网页问答采样；这些阶段按 skill 执行，`seo-mcp report` 不会自动串起后面几步。证据：`skills/seo-audit/SKILL.md:30-62`、`skills/seo-audit/assets/audit.example.json:1-60`。

**Google AI 概览。** `aio_stats.py` 只读 `serp_rank.py` 主样本对应的原始缓存。`ai_overview` 仅有 `error` 时算“明确无概览”，不进入出现数；有 `page_token` 但没有 `references` 的引用列表算“折叠未展开”，单独计数，不当作未引用。`cited` 的单位是“引用本站的概览条数”，同一概览内重复引用本站只计一次；只有带引用列表的概览才进入引用率分母。通用题必须排除配置的品牌和品牌化技术词；有 `text_blocks` 才检查正文点名。输出 `aio-stats.json` 的 `aio/withRefs/folded/explicitNoAio/cited/generic/genericNamed` 等字段。证据：`skills/seo-audit/scripts/aio_stats.py:1-50`。

**外部平台。** `ext_metrics.py` 读 `full/external/ai_visibility.json`。各市场本站 visibility（0–100）取算术平均后除以 100，作为推荐率的首选；来源页覆盖按各市场 `1 − missing/all` 计算，再跨有完整来源计数的市场取均值。`all` 必须是全量来源，不能取榜单前 100。缺数据则对应检查项未测。输出 `ext-metrics.json`。证据：`skills/seo-audit/scripts/ext_metrics.py:1-14,60-75`、`skills/seo-audit/references/data-collection.md:158-162`。

**AI 网页实测。** 每个重点市场预设 8 题：N1–N6 为无品牌推荐题，B1–B2 为品牌参数题；题集 `full/geo/questions.json` 记录版本和冻结日期，复测须原样复用。`full/geo/facts.json` 为带官网出处的官方参数基准。每个回答在 `answers.jsonl` 一行，记录引擎、市场、题号、是否提及/推荐、引用、准确性、错误明细及 `memory_biased`。采集本身在网页端完成；`geo_probe.py` 只汇总已经落盘的回答，不负责向 AI 提问。证据：`skills/seo-audit/references/data-collection.md:164-184`、`skills/seo-audit/scripts/geo_probe.py:1-28`。

`geo_probe.py` 先验证每条回答的市场和题号确实存在于题集。B 题只有 `accurate` 非 null 才进准确率分母；`accuracy.rate = ok/n`，按引擎分组，并展开错误清单。判为不准确却没填 `errors` 时脚本直接失败。N 题推荐率只用 `memory_biased` 为假或未标记的“干净样本”，`recommend.rate = recommended/n_clean`；没有干净样本则为 null。自家登录账号的临时聊天仍可能受记忆影响，其推荐数据不计分，但品牌题事实核对照常计。`citations` 是 N 题回答中各域名出现的回答数（每回答内先去重），最多输出前 30。结果是 `full/geo-probe.json`。证据：`skills/seo-audit/scripts/geo_probe.py:30-56`、`skills/seo-audit/references/data-collection.md:178-180`。

## 4. 客户版 GEO 评分的全部七项

这是 `skills/seo-audit/references/rubric.md` 的报告契约，和第 2 节的 52 分可引用度工具不是同一个公式。每项通过率应能从原始数据重算，分母须写清楚。

| GEO 分项 | 权重 | 通过率/取值 |
|---|---:|---|
| AI 爬虫可达 | 15 | robots 放行主要 AI 爬虫；正文存在于原始 HTML。 |
| 可引用性 | 20 | description 非空、正文语言与目录一致、最高级宣称附近有出处、评价/对比问题有承接页。这里也不是 `kp-geo-v1` 分数。 |
| 引用率 | 20 | 带引用列表的 Google AI 概览中引用本站的条数 ÷ 带引用列表的概览条数；只有 AI 概览来源时报告注明。 |
| 点名率 | 10 | 不含品牌及品牌化技术词的问题里，AI 概览正文提到品牌的条数 ÷ 可检查正文的通用题数。 |
| 推荐率 | 15 | 优先用第三方多平台 AI 可见度的各市场平均 ÷100；没有平台数据才用网页端干净样本 `geo_probe.recommend.rate`；都没有则未测。 |
| 来源页覆盖 | 10 | 各市场 `1 − missing/all` 的平均；使用全量来源。 |
| AI 介绍准确 | 10 | 有事实判定的品牌题中，无参数性错误的回答数 ÷ 已判定品牌题数；官网未提供的参数不计错。 |

分项分数为 `权重 × 该项已测检查项通过率的平均`；总分为 `已测分项得分之和 ÷ 已测权重 × 100`，四舍五入到整数。一个定义了多个检查项的分项，已测少于两项或少于一半则整个分项未测；单检查项分项有数据就计。不适用项从该分项剔除。综合分是 `SEO×0.6 + GEO×0.4`。等级 A≥85、B≥70、C≥55、D≥40、E<40；显示的分项可四舍五入，合计须用未取整值。报告还应单列引用、点名、推荐、来源页覆盖、介绍准确五项的合计与实得，避免爬虫可达满分遮住真实 AI 表现；SEO 与 GEO 同时计入的 description、语言、出处要披露。证据：`skills/seo-audit/references/rubric.md:1-49`。

## 5. GEO 监测循环的实现细节

配置必须是 `.kunpeng/geo/config.json`，三个字段 `brandNames/brandDomains/questions` 均为字符串数组；缺文件、非法 JSON 或类型不符都会抛错。每波默认取前 8 题，可用 `maxQuestions` 限制。逐题调用 `AgentRunner` 的 `review` stage，工具只给 `websearch`，提示模型用实时网页搜索，返回 `summary/citedUrls/mentionedBrand` JSON；循环执行结果并非客户审计网页端的多引擎样本。证据：`orchestrator/src/loop/recipes/geo-monitor/runwave.ts:42-110,145-182`、`core.ts:30-42`。

解析只取第一个 JSON 对象。无法解析则该题 `error=unparseable`；执行异常记录截断至 120 字的错误。`citedUrls` 只留合法 HTTP(S) 完整 URL，按原字符串去重，最多 20；`citedDomains` 合并模型给的域名和 URL hostname，去重。品牌域名命中要求与配置域名完全相等或是其子域名，避免 `notexample.ai` 误中 `example.ai`。`mentioned` 为模型显式返回 `mentionedBrand=true` **或** 引用域名命中品牌域名；它并不重新扫描 `summary` 里的品牌文字，也不判断“推荐”语义。证据：`orchestrator/src/loop/recipes/geo-monitor/core.ts:45-69,100-173`。

汇总的 `mentions` 是所有 `mentioned=true` 的题数，`errors` 是失败题数；`gaps` 只从无提及且无错误的问题中取前 5 个。循环尝试为前 5 个缺口创建 `geo-gap` 任务，按标题去重；任务创建失败被忽略，不影响报告。每波总会写 `.kunpeng/geo/report-<at>.json`，含 `answers/summary/instrument/ignoredSkills`。若全部题目失败，`instrumentBroken=true`、`verified=false`、指标保持旧值；否则 `metricAfter=mentions`，`verified` 要求总题数大于零且至少一题没报错。**部分题失败时这些题仍占 total 分母，而指标是提及绝对数，不是比率。** 监测 recipe 显式忽略送达 skills，报告记录 `ignoredSkills`，`skillsActivated=[]`。证据：`orchestrator/src/loop/recipes/geo-monitor/runwave.ts:112-237`、`core.ts:74-98`。

## 6. 研发接线与口径提醒

1. 要看页面能否被抽取，调用 `seo_geo_citability`；要看真实 AI 回答中的引用、推荐、准确性，必须提供 SERP、平台或网页采样数据。不可把 `kp-geo-v1` 分数映射为客户报告的“可引用性 20 分”或“引用率 20 分”。
2. `seo-mcp report` 的七层总灯仅以各层 `error` 数是否为零判定，GEO 可引用度不在其中；不要因为总灯绿色就声称 GEO 已审计。证据：`orchestrator/src/seo/report.ts:186-224`。
3. GEO 分数遇到未测项会重算权重分母，因此比较两次报告时还要比较已测项集合和市场、题集、引擎。冻结题集的 `version/frozen` 是复测可比性的基础。
4. 当前脚本负责数据汇总，客户版评分和 HTML 成稿按 skill 的报告生成流程执行；没有一个内置命令自动从 URL 跑出完整 GEO 总分。发布公开短链属于独立发布步骤。

## 7. 证据与验证范围

本文逐项核对了 `orchestrator/src/seo/gates/geo-citability.ts`、`orchestrator/src/seo/tools.ts`、`orchestrator/src/seo/report.ts`、`orchestrator/src/loop/recipes/geo-monitor/{core,runwave}.ts`、`skills/seo-audit/{SKILL.md,references/rubric.md,references/data-collection.md,scripts/{aio_stats,ext_metrics,geo_probe}.py}`，并对照 `orchestrator/test/seo/geo-citability.accept.test.ts` 与 `orchestrator/src/loop/recipes/geo-monitor/*.test.ts`。本次是实现梳理，未对外部网站或 AI 引擎做实测。
