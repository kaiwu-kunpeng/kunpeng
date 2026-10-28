---
name: seo-audit
description: 对任意网站做完整的 SEO 与 AI 可见性（GEO）审计，产出一份给客户看的单篇 HTML 报告（出具方默认开悟科技）：全站抓取、多语言、速度、页面规范、内容、搜索需求、各国 Google 实查排名、Google AI 概览引用、外链与权威度、各国自然搜索、多引擎 AI 推荐与来源、AI 介绍准确性、竞品对照，按固定检查项算 SEO / GEO 评分，经语言与逻辑两路独立审查、净化扫描后发布到 cockpit 公开短链。默认只诊断；用户要方案时切换方案模式，在同一份报告里加改进建议、修改单和执行计划。用户说「SEO 审计」「SEO 分析」「网站诊断」「SEO 体检」「看看这个站的 SEO」「AI 可见性 / GEO 审计」「各国排名怎么样」「出一份 SEO 报告给客户」「把这份 SEO 报告改一下 / 补数据」或丢来一个域名要全面分析时，都用这个 skill，即使没说「审计」二字。不用于：动手改网站、写 SEO 文案或落地页、做关键词投放方案、只查单个页面的 meta。
---

# SEO 与 AI 可见性审计（开悟科技）

把一个网站的搜索与 AI 可见性现状测清楚，写成客户能读懂、数字经得起重算、通篇正式商务语言的报告。

报告有两个独立维度：**模式**（诊断 / 方案，决定写什么）与**版本 + 主题**（完整诊断版 / 高管摘要版 / 技术附录版 / 方案执行版 × 四套配色，决定怎么呈现）。同一份数据层可同时出多个版本。

两种模式，写在配置 `report.mode`：

- **diagnosis（默认）**：只回答现在是什么样、证据是什么、影响在哪里，不给方案。
- **plan**：在诊断全文之后加三节方案（改进建议、修改单、执行计划），评分加「全部改完后」列。用户明确要方案、执行计划、改写稿时才用。诊断部分的写法与诊断模式完全相同，方案不得反过来改动诊断的数字和判断。

跑过的站：13 语种 2,598 页的制造业官网（完整版 + 方案模式 + 第三方数据补全，十二版迭代），395 页的旅游内容站（小规模测试）。教训在 references 里。

## 开工前确认

能从上下文推断的就不问：

1. 域名，要看的市场 / 语种（多语种站点列出各语种目录和对应国家）；GEO 实测的重点市场（通常 3–5 个，不必铺满）
2. 客户名；出具方默认「开悟科技」；模式（诊断 / 方案）
3. 可用的数据：SerpApi（实查排名）、Google API key（PSI + CrUX）、第三方 SEO 数据平台（外链、各国自然搜索、AI 可见度，需用户已登录）。没有就对应层标「未测」
4. 有没有 Search Console / GA4 权限（第三方审计通常没有）
5. 规模与消耗：市场数 × 每市场词数决定 SerpApi 消耗（免费档 250 次 / 月），平台报表按单位计费，先报预计消耗

付费动作（超出免费额度、贵的报表、多引擎 API）先问再做。**凭据由用户自己登录，不读凭据文件、不代输密码、不绕过安全拦截。**

## 工作目录与配置

默认工作目录 `~/kunpeng-strategy-docs/<日期>-<站点>-seo/`，所有产物进 `full/`。第一步把 `assets/audit.example.json` 复制成 `full/audit.json` 按站点填写（每个键的说明在 `_` 开头的注释键里）。**所有脚本只读这一份配置**，站点特有的东西（品牌、竞品、市场、出具方、报告编号、模式）都写在这里，不改脚本、不在正文里写死。

## 流程

详细做法与降级方案见 `references/data-collection.md`。脚本参数统一是 `--config full/audit.json`。

1. **七层检查**：`node ~/kunpeng-cron/orchestrator/dist/cli.js seo-mcp report <origin> --out full --max-pages 6000`（一定带 `--out`）。
2. **补充抓取**：`crawl.py`。
3. **派生指标**：`analyze.py` → analysis.json。
4. **搜索需求**：`kw_collect.py`，看分类结果，改 clusters / noise 后 `--build-only` 重跑。
5. **实查排名**：`serp_rank.py --dry-run` 看挑词和消耗，再正式跑。
6. **AI 概览**：`aio_stats.py`。
7. **速度**：`cwv_batch.py`；`http_checks.py`。
8. **竞品**：`competitors.py`（首页）；同等范围采集了竞品才给竞品打分。
9. **第三方数据**（data-collection 第 12 节）：外链对比、权威度分布、锚文本、各国自然搜索、AI 可见度与来源，落 `full/external/`，跑 `ext_metrics.py`。估算类数据只用于横向比较量级，**排名一律以实查为准**。
10. **GEO 实测**（第 13 节）：定题集 `full/geo/questions.json`（冻结后复测原样使用），在 AI 网页端逐题问，记 `full/geo/answers.jsonl`，跑 `geo_probe.py`。
11. **评分**：按 `references/rubric.md`。
12. **生成报告**：数据层 + 正文 + `assets/report_shell.py` 组装，版式用 `assets/base.css`（零色值）+ `assets/themes.py`（主题）+ `assets/print.css`（打印页眉页码）与 `assets/g_core.py`、`assets/charts.py`（纯 SVG 图表），版本与主题见 `references/report-structure.md`「版本与主题」，章节与写作规则同文件，客户版净化按 `references/client-language.md`。数字全部由脚本从 full/ 的 json 输出，经 `g_core.N(值, 键)` 进数字账本，正文不手写数字，也不手写判定常量；判定性文字（「德国、意大利第一」）用 `assets/claims.py` 的 `claim()` 声明校验，生成结束 `claims.dump("full/claims.json")`。
13. **自查**：`references/pitfalls.md` 清单逐条过，再跑 `scan_report.py`（净化 + 51 条中文 AI 腔规则 + 排版提示）与 `number_gate.py`（数字归属），退出码 0 才能往下走；最后 `pro_metrics.py --claims full/claims.json` 算评分表的确定性部分。
14. **独立审查**：按 `references/review-prompts.md` 并行派语言（含净化）、逻辑数字两个只读 agent；语言审查改过稿的，先过 `fidelity_check.py --before 改前 --after 改后`（数字、域名、标题、表格行数不变，汉字留存 ≥ 85%），不保真就拒收改稿；复核最多 2 轮；最后终审按 `references/pro-rubric.md` 出分数卡（内部，不进客户版），门全过且 ≥ 85 才交付。审查员的结论回原始数据核对后再采纳。
15. **发布**：见下方。

## 迭代已有报告

用户说「改一下这份报告」时：先找到原生成器和原会话（grep artifact id 或报告编号），重跑生成器并 `cmp` 确认与线上逐字节一致，再改源码重新生成，**不手改 HTML**。改前备份生成器；批量替换脚本先收集全部未命中项一次打印，不要一处断言失败整批中止；改完导出纯文本，按节眉「第 NN 节 · 共 M 节」截取逐节复读（按标题截取会先命中目录）。

## 客户版红线（两种模式都适用）

- 出具方一律写配置里的 `issuer.name`；旧品牌名（`issuer.former_names`）全文清零。
- 不出现第三方工具与数据商名（平台名、Authority Score、SerpApi……）；第三方平台数据统一写 `issuer.monitor_label`（「开悟系统监控数据」）；工具原始来源只记在 `full/*/README.md` 等内部文件。
- 不写数据局限、样本偏差、撞名、账号与额度、采集过程、已测权重这类内部说明；只写重点。推断不写成断言，用「主要成因有三……将在复测中确认」这类有限定的正式说法。
- 正式商务语言，去 AI 腔，不自问自答；结论直接列要点。
- 诊断模式另外不得出现方案内容（见 report-structure.md）。

## 交付组合（默认，用户 2026-10-09 定）

| 客户类型 | 交付的版本 |
|---|---|
| 诊断客户（`report.mode = diagnosis`） | 高管摘要版 + 完整诊断版 |
| 方案客户（`report.mode = plan`） | 高管摘要版 + 完整诊断版 + 方案执行版 |
| 有技术对接（客户技术团队或外包方要落地） | 在上面基础上加技术附录版 |

组合写在配置 `report.editions`，生成时逐个版本出，同一份数据层、同一套数字账本；各版本都要过 `scan_report.py` 与 `number_gate.py`。主题默认按版本取（诊断版 graphite-cobalt、高管版 ink-serif、执行版 teal-playbook、技术版 swiss-mono），客户品牌色只作强调色。每个版本一个公开短链，`<slug>`、`<slug>-brief`、`<slug>-plan`、`<slug>-tech`。

## 发布

1. 报告单文件 HTML 留在工作目录；复制一份到 `~/kunpeng-strategy-docs/<slug>-seo-report-<日期>.html`（docs 根目录）。
2. **cockpit 公开短链**：在 `~/.kunpeng/public-reports.json` 加一行 `"<slug>": "<文件名>"`（slug 只用小写字母、数字、连字符），实时生效、免登录，地址 `https://cockpit.aeohq.io/r/<slug>`。验证：`curl -sD - -o /tmp/pub.html https://cockpit.aeohq.io/r/<slug>` 看到 200 与 `x-robots-tag: noindex, nofollow`、`cache-control: no-store`，`cmp` 正文与本地文件一致。更新报告 = 覆盖同名文件，链接不变；撤销 = 删掉那一行。
3. 需要 claude.ai 预览时 `Artifact publish` 同一个 file_path（固定 URL 迭代）。预览里目录锚点不跳，渲染验证改在本地 `python3 -m http.server` 下做。
4. `node ~/kunpeng-cron/orchestrator/dist/cli.js capture file <报告路径>` 存入知识库；`full/external/README.md`、`full/geo/README.md` 一并入库。
5. 回复用户：链接、三个评分、三到五条主要发现、未测的层、需要用户决定的事。用户在对话里贴过 key 的，提醒轮换。

测试或演练时跳过第 2、4 步。

## 文件

- `scripts/_cfg.py`：配置、key、语种目录、页型、落盘文件名
- `scripts/crawl.py`、`analyze.py`：补充抓取、派生指标
- `scripts/kw_collect.py`、`serp_rank.py`、`aio_stats.py`：搜索需求、实查排名、AI 概览
- `scripts/cwv_batch.py`、`http_checks.py`、`competitors.py`：速度、跳转与压缩、竞品首页
- `scripts/ext_metrics.py`：外链与 AI 可见度 → 评分通过率
- `scripts/geo_probe.py`：GEO 网页实测汇总（准确率、推荐、错误清单）
- `scripts/scan_report.py`、`scripts/zh_rules.py`：交付前净化扫描、中文 AI 腔规则（51 条，带来源）
- `scripts/number_gate.py`：数字归属门（账本覆盖率，enforce 模式未登记即失败）
- `scripts/fidelity_check.py`：改稿保真闸
- `scripts/pro_metrics.py`：专业度评分表的确定性部分
- `assets/claims.py`：判定句断言注册表
- `assets/audit.example.json`：审计配置模板
- `assets/report_shell.py`、`assets/g_core.py`：报告外壳（主题、版本、打印）、表格 / 封面 / 评分环 / ●■▲ 标记工具
- `assets/base.css`、`assets/themes.py`、`assets/print.css`：零色值基础样式、四套主题、打印页眉页码
- `assets/charts.py`：纯 SVG 图表（子弹图、排序条形、哑铃图、九宫格、热力格、气泡）
- `assets/brief.py`、`assets/brief.css`：高管摘要版（问题清单、改进重点、市场热力格）
- `assets/annex.py`、`assets/annex.css`：技术附录版（问题总表、修改单、改写稿、URL 清单导出 CSV）
- `assets/playbook.py`、`assets/playbook.css`：方案执行版（甘特、分月工作表、负责矩阵、验收节点）
- `references/data-collection.md`、`rubric.md`、`report-structure.md`、`client-language.md`、`pro-rubric.md`、`pitfalls.md`、`review-prompts.md`
