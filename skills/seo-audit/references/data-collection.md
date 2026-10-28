# 数据采集

每一层的数据来源、工具和成本。原则：能用确定性工具取到的，不让模型估；取不到的，报告里标「未测」。所有脚本参数统一 `--config full/audit.json`，输出都在 `full/`。

## 目录

1. 工作目录与配置
2. 七层检查（kunpeng-seo）
3. 补充抓取与派生指标
4. 搜索需求
5. Google 实查排名（SerpApi）
6. Google AI 概览
7. 速度、跳转、压缩
8. 竞品首页
9. key 与安全
10. 环境坑
11. 做不到的层
12. 第三方数据：外链、各国自然搜索、AI 可见度
13. GEO 网页实测：推荐与 AI 介绍准确

## 1. 工作目录与配置

```
<工作目录>/            默认 ~/kunpeng-strategy-docs/<日期>-<站点>-seo/，用户指定则用用户的
  full/audit.json      从 assets/audit.example.json 复制后填写
  full/html/           落盘 HTML（gzip）
  full/*.json(l)       各脚本产物
  full/serp-raw/       SerpApi 原始响应缓存
  <站点>-seo-audit-<日期>.html
```

配置里每个键的含义写在同名 `_` 注释键里。填配置时最花心思的是 clusters（主题分类）、key_pages（重点页与主关键词）和 claims（最高级词表），它们直接决定评分，填完在报告的口径一节里如实披露。

## 2. 七层检查（kunpeng-seo）

```
node ~/kunpeng-cron/orchestrator/dist/cli.js seo-mcp report <origin> --out full --max-pages 6000
```

一定带 `--out`，否则默认写进鲲鹏仓库的 `.kunpeng/seo-reports`。也可以用 MCP 工具 `mcp__kunpeng-seo__seo_site_report`（传 outDir），大站结果会被截断，命令行更稳。

这一步取的是层级结论：robots 各类爬虫的放行判定、发现层入口存活、canonical 目标、首个 HTML 是否含正文、sitemap 与入链对照。它的 JSON 只有规则计数，没有逐页明细；它的抓取范围（含参数变体）和补充抓取不同。**报告里的页级计数一律用补充抓取（analysis.json）**，同一个指标不要在两个来源间混用分子分母。两边都有而数字不同的（例如「description 偏短」），用补充抓取的，并在口径里写明。

它的「JavaScript 空壳」判定按空格数词，中日泰文页会误报，要逐条核。

## 3. 补充抓取与派生指标

```
python3 scripts/crawl.py   --config full/audit.json
python3 scripts/analyze.py --config full/audit.json
```

`crawl.py` 从首页顺链接广度优先抓完，再补抓 sitemap 里没到过的 URL（`source=sitemap-only`）。sitemap 自动发现（配置 > robots.txt 的 Sitemap 行 > 常见路径），索引递归，支持 .gz。遵守 `User-agent: *` 组的 Disallow，配置 `crawl.skip_paths` 跳过框架资源路径。约 400 页 3–5 分钟。

`analyze.py` 只读落盘文件，不再请求对方站点。它输出的每个比例都带分母，报告直接引用。需要加新指标时在它的输出里加字段，不要在报告正文里临时算。

## 4. 搜索需求

```
python3 scripts/kw_collect.py --config full/audit.json            # 采集 + 分类
python3 scripts/kw_collect.py --config full/audit.json --build-only  # 改了 clusters / noise 后只重新分类
```

Google 自动补全（按各市场 gl + hl）。种子词每个市场 15–25 个，覆盖品牌、主营品类、核心服务、城市或型号、对比、价格、评价。输出每个类别的前几个词，逐类看一遍：分类错了改 clusters，无关词加进 noise。品牌词不在补全里时，按 brand_terms 补入（seedHits=0）。

**没有搜索量**，报告里写明排序依据是补全命中次数。有 DataForSEO 或 Keyword Planner 时再补。

## 5. Google 实查排名（SerpApi）

```
python3 scripts/serp_rank.py --config full/audit.json --dry-run   # 看挑词、未归类主题、预计消耗
python3 scripts/serp_rank.py --config full/audit.json [--requery-corrected]
```

- 每个市场按主题轮流挑 `serp_per_market` 个词，顺序 = 品牌词 + 配置 clusters + 通用品类词。dry-run 会列出不在顺序里的主题（它们归入「其他」，最后才被挑到）。
- 免费档每月 250 次，先查余额再跑。查余额的接口 `https://serpapi.com/account.json?api_key=…` 不扣次数；用 python 读 key 再请求，别在同一条 Bash 里同时出现 key 文件路径和 curl。
- 结果缓存在 `serp-raw/`，重跑不扣费。
- **品牌词被自动纠正**：陌生品牌常被 Google 改成近似常见词（例如两个词连写被拆开），结果是另一家公司。脚本记录 `corrected` 与 `showingResultsFor`；`--requery-corrected` 对被纠正的品牌词用 `nfpr=1` 按原拼写各重查一次。没有重查时，报告写明「品牌词被纠正，按原拼写的结果未采集」，评分里该项记未测。
- 第一页通常只有 8–10 条自然结果（`organicCount`），报告写「第一页」，不写「前 10」。
- 中文市场用 google.com.hk + hl=zh-cn 替代，写明「不代表百度」。
- 要给某个结论补证据（例如品牌词不在第一页），单独补查第二页（`start=10`），存成 `serp-raw/<loc>/verify-*.json`，统计脚本会跳过它。

## 6. Google AI 概览

```
python3 scripts/aio_stats.py --config full/audit.json
```

用实查排名的缓存，不额外花钱。配置的 `brand` 要包含品牌专有的技术名、产品线名，否则「通用问题点名率」会被抬高；`review_clusters` 写评价、对比类主题名。口径说明在脚本头部。

这只是 Google 一个引擎的抽样。ChatGPT、Perplexity、Gemini 的引用、推荐、描述准确需要固定题集多次采样，本 skill 不做，报告标「未测」。

## 7. 速度、跳转、压缩

```
python3 scripts/cwv_batch.py   --config full/audit.json   # CrUX（全站 + cwv_urls）+ PSI 手机实验室
python3 scripts/http_checks.py --config full/audit.json   # 跳转链、压缩、缓存头、单次 TTFB
```

CrUX 返回 404 = 样本不足，照写。小站常常全站都样本不足，这时速度分项记未测（见 rubric）。没有 Google key 时可用 Chrome DevTools 录一次 trace 带回几个 URL 的 CrUX。跳转判定接受 301 和 308，要求一跳直达 https 主域。只抽查时报告写「抽查的页面」。

## 8. 竞品首页

```
python3 scripts/competitors.py --config full/audit.json
```

3–5 家，只取首页，不给竞品打分。拒绝访问或无响应的照实写。

## 9. key 与安全

- key 存 `~/.kunpeng/seo-keys.env`（`SERPAPI_KEY=`、`GOOGLE_API_KEY=`），用 Write 工具写入，权限 600。脚本内部读取，也可用环境变量覆盖。
- 鲲鹏的安全绊线会拦「同一条 Bash 里同时出现 key 文件路径和 curl」的命令。
- 用户在对话里贴过的 key，交付后提醒轮换。
- 付费 API 动用前先问用户。

## 10. 环境坑

- macOS 没有 `timeout` 命令，命令示例别用它；超时交给 curl 的 `-m` 或 Python 的 timeout 参数。
- 长任务（全站抓取、PSI 批量）放后台跑，别卡在前台超时。
- 并发 agent 同时在跑时，Bash 回显可能混入别的输出，关键结果以落盘文件为准。

## 11. 做不到的层

| 层 | 需要什么 | 报告里怎么写 |
|---|---|---|
| 索引覆盖、查询词、点击率、品牌词拆分 | 站点方授权的 Search Console | 未测；排名用实查代替 |
| 行为与转化 | GA4 | 未测 |
| 爬虫实际来访 | 源站访问日志 | 未测 |
| 外链、引荐域名、权威度 | 第三方 SEO 数据平台（第 12 节） | 无平台权限时未测，不评分 |
| AI 推荐、来源页覆盖、介绍准确 | 平台 AI 可见度（第 12 节）+ 网页实测（第 13 节） | 两者都没有时未测，不评分 |

## 12. 第三方数据：外链、各国自然搜索、AI 可见度

目前用 Semrush（MCP + 网页端）。报告里不出现平台名，见 client-language.md；原始来源、日期、报表名、消耗写进 `full/external/README.md`。

**接入**：用户自己登录。MCP 走 OAuth：`authenticate` 返回授权链接，在浏览器打开后自动回调；`ToolSearch "+semrush"` 加载工具。调用顺序：分类工具不带参数列出报表名 → `get_report_schema(report)` → `execute_report(report, params)`。

**可用报表**（单位消耗为一次实跑的量级，贵的先问）：

| 报表 | 参数要点 | 落盘 | 消耗 |
|---|---|---|---|
| backlinks_comparison | targets = 本站 + 竞品根域名，target_types 全为 root_domain | `external/backlinks.csv`（原样分号分隔导出） | ~1,000 |
| backlinks_ascore_profile | 本站 root_domain | `external/authority_profile.json` `{"权威度": 引荐域名数}` | ~7,000，贵，竞品不拉 |
| backlinks_anchors | display_limit 30，按 domains_num 降序 | `external/anchors_top30.json` `{pulled, rows:[{anchor, domains, cls}]}`，cls ∈ brand / news / spam / generic / empty，人工标注 | ~3,000 |
| domain_ranks | 每家一次，export_columns database, domain, organic_keywords, organic_traffic | `external/organic_by_market.json` `{pulled, domains:{域名:{库:{kw, traffic}}}}` | 每家 700–2,100 |
| resource_organic | 某市场库，按流量取前 20 | `external/organic_top_<库>.csv` | ~200 |

**不可用**：traffic_overview（no_subscription）、任何 AI 可见性报表（MCP 没有）、projects 列表（空且扣费）。

**AI 可见度只在网页端**（需 Semrush One，普通账号弹付费墙；只有 US / UK / DE / FR 四个库）：
- `https://zh.semrush.com/ai-seo/competitor-research/?q=<本站>&compareWith=<竞品1>%7C<竞品2>&db=<库>`：可见度（0–100）、话题与来源计数（all / missing / weak / shared / strong / unique）
- 同页加 `&preset=sources&sort=promptsCount.desc`：来源表，每页 10 行，点「Next」翻页，用 `[role=row]` / `[role=gridcell]` 逐页读，前 100 行落 `external/ai_sources_<库>.csv`（domain, 各品牌列, urls, prompts）
- 汇总成 `external/ai_visibility.json`：`{"pulled": 日期, "markets": {"de": {"visibility": {域名: 分}, "sources": {"all": n, "missing": n}, "topics": {...}, "top_gap_topic": "..."}}}`

规则：
- **逐页读页面，不调网站背后的数据接口**（用户明确要求）。
- 来源页覆盖用全量来源（1 − missing ÷ all），不用前 100 来源（会算出九成以上）。
- 平台数据直接采用，不再花额度逐条人工复核；但**排名以实查为准**：平台记某词第 1、实查第一页没有官网时，正文用实查，平台估算流量只作五家横向比较。
- 平台站点审计只抓 100 页、只查已有 hreflang 的冲突，口径比本 skill 宽，不用它的结论替代全站抓取。

最后跑 `python3 scripts/ext_metrics.py --config full/audit.json`（配置 external.peers 写竞品根域名，同一家多个域名只放一个）。

## 13. GEO 网页实测：推荐与 AI 介绍准确

**题集** `full/geo/questions.json`：每个重点市场 8 题，用当地语言写，冻结后复测原样使用（记 version / frozen）。
- N1–N6 不含品牌：本国该品类最好的品牌、效率或性能最高的产品、核心技术对比、特定场景表现、外观或细分品类、最可靠质保最好的厂商（按行业改写）
- B1–B2 品牌题：「<品牌> 产品怎么样，质保和关键参数是多少」「<品牌> 和 <主要竞品> 哪个好」

**官方参数基准** `full/geo/facts.json`：按型号列效率、功率、质保等，每条带官网出处 URL。

**采集**：没有可用的多引擎 API 时，在浏览器里逐题问，结果一行一条写进 `full/geo/answers.jsonl`（字段见 geo_probe.py 文档）。
- ChatGPT：`https://chatgpt.com/?temporary-chat=true`，页面加载完（约 8 秒）再输入。输入框是 ProseMirror 的 `[contenteditable="true"]`；标签页在后台时 computer 的 type 打不进字，用 `el.focus(); document.execCommand('insertText', false, 问题)`，再点 `button[aria-label="发送"]`（界面语言不同按钮名不同）。约 30 秒后从 `main.innerText` 取最后一个回答；引用来源是「域名 +N」形式的按钮，不是链接。
- Claude：`https://claude.ai/new?incognito=true`，同样 execCommand 输入，发送按钮按界面语言（繁体是「傳送訊息」），出现「已完成回覆」后截取。
- 每批 1–2 题，超过约 3 题浏览器批处理会超时；扩展断开时用 tabs_context 恢复。
- 第一题别在普通聊天里问（会留在用户聊天记录里）。

**判定**：品牌题对照 facts.json 只计参数性错误，官方没写的不计；每个判错的回答在 errors 里写「AI 说法 / 官方参数」，报告错误表由此生成。

**记忆偏差**：自家登录账号的 ChatGPT 临时聊天仍会用账号记忆（回答荷兰的问题时冒出「in Germany」），推荐数据会被抬高，`memory_biased: true`，不计推荐率；品牌题的事实核对受影响小，照常计分。推荐率优先用第 12 节的 AI 可见度。

**API 路线**：SerpApi 的 google_ai_mode 引擎可测 AI Mode，但额度耗尽返回 429；Serper 只有自然结果、没有 AI 结果；在自动模式下调用外部 CLI 跑模型可能被权限分类器拦，被拦就停，不绕过。

最后跑 `python3 scripts/geo_probe.py --config full/audit.json`。
