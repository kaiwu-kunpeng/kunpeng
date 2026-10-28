# Changelog

本文件记录鲲鹏（kunpeng）的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

`1.0.0` 是首个正式版本；此后版本号遵循语义化版本。版本号**单一来源** = `package.json`（`src/index.ts` 运行时读取，不再硬编码）。发布流程：`npm version <patch|minor|major>` 升 `package.json` → 更新本文件 → 打 tag。

## [Unreleased]

### Changed
- 插件 git 来源（url + 40 位 commit 钉版，clone 到插件根 cache/）与 `plugin upgrade / rollback`（只升不降、换版注销旧版技能/MCP 后重新启用、previous 可来回）；doctor 查 git HEAD 与市场钉的 commit（p1-7c-插件对齐-plugins-1-0-三-git-来源-url-comm-0-0；流因三流并发全量测试负载超时 16 条假红停在 implement，分支 diff 与预演参考逐行一致，人工在安静机器上全量 1596 文件复验后合入）
- CLI 参考由命令注册表生成索引，补齐 29 个缺失命令并加守门测试（users-admin-kunpeng-docs-specs-2026-0-mulfo9rw）
- install --service 的 launchd 加载提示补上「注销再登录」：手工 bootstrap 拿不到 managed LWCR 会被系统回收（users-admin-kunpeng-docs-specs-2026-0-mulge0ri）
- kunpeng-seo：AI 爬虫单一登记表 + robots 规则按 RFC 9309 匹配（通配符与 $）（users-admin-kunpeng-strategy-docs-202-muli4d72）
- kunpeng run：spec 里作者写的 accept 块优先于 spec 阶段转述的 TESTCMD，且 TESTCMD 剥掉外层反引号（users-admin-kunpeng-strategy-docs-202-mulim243）
- kunpeng-seo 抓取器：记录跳转后的最终 URL、跳转页不进内容层、确定性分批并发（users-admin-kunpeng-strategy-docs-202-mulim6t5）
- 背景（2026-10-03 两次 Claude Code 会话在驾驶舱终端里被杀退出）（pty-孤儿清扫不得误杀活终端-有客户端连着的会话不杀-且只有-kunpeng--0-0）
- 背景（2026-10-03 一晚三次 Claude Code 交互会话在驾驭舱终端里退出，用户连续三次要求"彻底解决"）（终端会话不许误杀-tmux-前缀换-kpt-有程序在跑不杀-闲置只断客户端不杀会-0-0）
- 背景（2026-10-03 插件/通讯/运营审计 A1 S1 第 1 条，总报告 P0-2）（p0-2-插件-mcp-条目不参与宿主凭据注入-origin-为-plugin--0-0）
- 背景（2026-10-03 插件/通讯/运营审计 A1 S1 第 2、3 条与路径逃逸实测，总报告 P0-3）（p0-3-插件启用加固-技能过安全扫描才启用-id-撞既有注册项整体拒绝-man-0-0）
- 背景（2026-10-03 通讯审计 A2 S2 第 4 条，总报告 P0-7）（p0-7-presence-长活心跳-仓内部分-serve-自身-30s-心跳--0-0）
- 背景（2026-10-03 运营审计 A3 G3，总报告 P0-6 后半）（p0-6b-l4-运营门服务端二次确认-api-ops-gate-decide--0-0）
- 背景（2026-10-03 运营审计 A3 G3，总报告 P0-6）（p0-6a-运营-driver-杠杆动作等级门-去客户名重派-recipe-缺省-0-0）
- 背景（2026-10-03 通讯审计 A2 S2，总报告 P0-7 用户级部分的仓内前置）（p0-7b-register-agent-加-beat-only-只刷同一实例的-0-0）
- 背景（2026-10-03 通讯审计 A2 S1 第 2、3 条，总报告 P0-4）（p0-4-通知通道活性可观测-告警入-spy-重派-每轮扫描落-phone-sc-0-0）
- 背景（2026-10-03 运营审计 A3 G2，总报告 P0-5）（p0-5-运营台账证据来源-wave-台账带-evidencekind-reci-0-0）
- 背景（ADR-0020 / 2026-10-03 运营审计 A3 G1，总报告 P1-1）（p1-1a-运营调度收回-一-kunpeng-ops-run-playbook--0-0）
- 背景（ADR-0018 / 2026-10-03 通讯审计 A2 S2-5）（p1-2a-总机接真实消费者-回滚-stderr-入-spy-重派-缺省文件发送-0-0）
- 背景（ADR-0020 / 审计 P1-1 第二段、P1-4 后半「连续失败自动 pause 进收件箱」）（p1-1b-运营调度收回-二-应跑账本守卫-连续失败自动暂停-ops-resum-0-0）
- 背景（2026-10-03 审计总报告 P1-4；对标 Claude C1/C2）（p1-4-外部触发体一律包不可信标记-含同址旧测试同步-五派-api-dispa-0-0）
- 背景（2026-10-03 审计总报告 P1-11；记忆里两条旧伤「派流并发上限 4 会静默超时」「codex 额度尽=静默空跑」）（p1-11a-派流失败可见-槽位超时落状态不再静默退出-写锁撞车单独归因-后端全-0-0）
- 背景（2026-10-03 运营审计 A3 G4，总报告 P1-8）（p1-8a-学习环接通-一-ops-run-playbook-跑完一波后把领航选-0-0）
- 背景（2026-10-03 运营审计 A3 G4，总报告 P1-8）（p1-8b-学习环接通-二-recipe-声明是否吃技能-领航只给吃技能的-re-0-0）
- 背景（2026-10-03 运营审计 K5，总报告 P1-6）（p1-6-预审发现三桶进合并门-二派-flowstate-压回-600-行内-f-0-0）
- 背景（2026-10-03 运营审计，总报告 P1-3；GitHub #1 / Codex #3#4）（p1-3-动作策略第二维-操作类别-deny-ask-allow-require-0-0）
- 背景（2026-10-03 运营审计 A4 #1，总报告 P1-12）（p1-12a-处置手册引擎-一-纯决策层-首批六条-l0-l2-手册-0-0）
- 背景（2026-10-03 运营审计 K4，总报告 P1-5；Codex #6 / Claude B4 / WorkBuddy #5）（p1-5-im-可回传审批-一次性票据-先到先用-文本回复-yes-no-im--0-0）
- 背景（2026-10-03 运营审计 A4 #1，总报告 P1-12 第二步；前置 P1-12a 已合入 main 85ea8be5）（p1-12b-处置手册引擎-二-三派-值班员接事件源与执行器-kunpeng-d-0-0）
- 背景（2026-10-03 运营审计 A3 G4，总报告 P1-8 第三步；前置 P1-8a/8b 已合入）（p1-8c-学习环接通-三-运营蒸馏源-杠杆-技能战绩计数-tier-1-经验--0-0）
- 背景（2026-10-03 运营审计 A4 #3，总报告 P1-10；开悟 #3）（p1-10a-收件箱-为什么到你这里-二派-评估器关-来由-触发方-把握三档-三-0-0）
- 背景（2026-10-03 运营审计 A4 #1，总报告 P1-12 第三步；前置 P1-12b 已合入 main 8d074286）（p1-12c-处置手册引擎-三-值班员随-kunpeng-ops-定时器每轮跑一-0-0）
- 背景（2026-10-03 运营审计 A4 #3，总报告 P1-10 第二步；开悟 #3「改判弹提案」；前置 P1-10a `server/inbox-triage.ts` 须已合入 main）（p1-10b-收件箱改判-进化提案-批了-不该办-或驳了-能办-自动落账并起草--0-0）
- 背景（2026-10-03 插件审计 A1 S2 / K1，总报告 P1-7 第一步；Cursor #1/#2）（p1-7a-插件对齐-plugins-1-0-一-manifest-扩五类贡献--0-0）
- 背景（2026-10-03 插件审计 A1 S2 / K1，总报告 P1-7 第二步；前置 P1-7a 已合入 main 6b03629b）（p1-7b-插件对齐-plugins-1-0-二-marketplace-jso-0-0）
- 背景（2026-10-03 运营审计 A3 G6，总报告 P2-8 前半；驾驭舱 loops 视图已按 projectId 分组，CLI 侧没有）（p2-8a-kunpeng-loops-显示-projectid-多租户串仓一眼-0-0）
- 背景（2026-08-18 审计「79.9% 回滚无归因」；2026-10-05 盘点 .kunpeng/state：83 条 rolled-back 里 29 条无 rollback 落账，全落 unknown；suggestions「h…（回滚归因确定性分类-kind-固定归因枚举-unknown-占比指标-五类漏归因-0-0）
- 方案集成 plan-muxhb402-6c78b7（plan-muxhb402-6c78b7）
- 目标（public-report-route-0-0）
- 方案集成 plan-mvchv2dh-505e23（plan-mvchv2dh-505e23）
- 方案集成 plan-mvchsfru-b2c341（plan-mvchsfru-b2c341）
- 方案集成 plan-mvchgr5m-fa86e5（plan-mvchgr5m-fa86e5）
- 方案集成 plan-mvcioptj-04492a（plan-mvcioptj-04492a）
- 方案集成 plan-mvcit8i7-e10901（plan-mvcit8i7-e10901）
- 方案集成 plan-mvciastc-485ce7（plan-mvciastc-485ce7）
- 方案集成 plan-mvcjwgbp-d1cff9（plan-mvcjwgbp-d1cff9）
- 方案集成 plan-mvck14mi-ac55d7（plan-mvck14mi-ac55d7）
- 方案集成 plan-mvckau59-894bbe（plan-mvckau59-894bbe）
- 方案集成 plan-mvckuds7-417f03（plan-mvckuds7-417f03）
- 方案集成 plan-mvclb7w7-387b2e（plan-mvclb7w7-387b2e）
- 方案集成 plan-mvclohj0-52ab3d（plan-mvclohj0-52ab3d）
- 方案集成 plan-mvcm7g33-eef9a1（plan-mvcm7g33-eef9a1）
- 方案集成 plan-mvcmzagr-d0e32e（plan-mvcmzagr-d0e32e）
- 目标（actor-no-spoof-agent-sessions-cannot-rec-0-0）
- 方案集成 plan-mvdbqazr-6bdb6c（plan-mvdbqazr-6bdb6c）
- 方案集成 plan-mvdbq9f4-f59082（plan-mvdbq9f4-f59082）
- 方案集成 plan-mvdc8yik-815829（plan-mvdc8yik-815829）
- 方案集成 plan-mvdcntjs-281edc（plan-mvdcntjs-281edc）
- 方案集成 plan-mvdcglxg-7567d3（plan-mvdcglxg-7567d3）
- 方案集成 plan-mvfekely-86d8c4（plan-mvfekely-86d8c4）
- 方案集成 plan-mvfez9kt-540be7（plan-mvfez9kt-540be7）

### Fixed
- kunpeng-seo 字数统计支持中日泰等无空格文字：首个 HTML 空壳判定与页面审计不再误报（users-admin-kunpeng-strategy-docs-202-muleaupz）
- 修复 main 红灯：CHANGELOG 1.1.0 收口测试与「合并自动追加 Unreleased」契约冲突（users-admin-kunpeng-strategy-docs-202-mulhokwu）

### Added
- kunpeng-seo 新增结构化数据门：JSON-LD 抽取 + Google 富结果必填/推荐字段校验 + seo_structured_data 工具（users-admin-kunpeng-strategy-docs-202-mulfpx32）
- kunpeng-seo 新增 hreflang 集合校验门：语言码合法、互相回指、目标可达且 canonical 自指、语言与目标页一致（users-admin-kunpeng-strategy-docs-202-mulj8r0o）
- kunpeng-seo 新增 AI 爬虫日志报表工具：按类别统计、逐日趋势、「被检索却没被用户取用」漏斗（users-admin-kunpeng-strategy-docs-202-mulkq2xi）
- kunpeng-seo 新增 GEO 可引用度门：逐页评分（观测不到的项不进分母）+ seo_geo_citability 工具（users-admin-kunpeng-strategy-docs-202-mulla0sp）
- kunpeng-seo 接入 Google Search Console：seo_gsc_sites / seo_gsc_query / seo_gsc_inspect 三个只读工具（users-admin-kunpeng-strategy-docs-202-mulltkc8）
- 对话额度降级链增加 Sonnet 5.5 → Sonnet 5（users-admin-kunpeng-docs-specs-2026-0-mumhrntl）
- 对话模型下拉增加 Sonnet 5.5（claude-sonnet-5-5）（users-admin-kunpeng-docs-specs-2026-0-mumhx3rr）
- 对话模型下拉增加 Haiku 5.5（claude-haiku-5-5）（users-admin-kunpeng-docs-specs-2026-1-muzbm5je）

### Security
- 背景（2026-09-28 商业交付审计 C-security；2026-09-29 清理临时 worktree 时确认 main 仍未修）（w1-11-通知设置密钥不外泄-get-api-settings-notify--0-0）

### Removed
- 对话模型下拉下线 Opus 4.8、Sonnet 4.6、Opus 5 · 1M（users-admin-kunpeng-docs-specs-2026-1-muzcm4kk）

## [1.2.0] - 2026-09-28

### Added
- 决策收件箱：所有待人裁决的事项统一为一种结构并记录裁决人；提供批准 / 驳回 / 暂缓三键，硬门与软门分区显示并二次确认，按影响范围排序；支持每日配额、过期降级、缺席模式与按 owner 过滤。
- 目标对象 `kunpeng goal`：每个仓库可登记目标，派流可带 `--goal` 归属，未归属的流单独成桶；周报把「进展与证据」和「下一步 KR 建议」拆成两次调用，人确认后才更新目标。
- 动作分级表 L0–L4（单一来源 `policy/action-levels.ts`），收件箱与运营环都标注等级；L4 发布改为服务端两步确认，并拒收合成证据。
- 实现 agent 可以主动求助（`RAISE_BLOCKER`），求助会出现在收件箱与 ACP `/status` 中，用 `/answer` 答复后流程续跑。
- ACP 薄适配层 `kunpeng acp`：支持 ACP 的编辑器可以查看流状态、派发 spec、答复求助。
- 合并前守门测试：守门测试变红时保留人工门，并记录「碰红」原因；合并后自动重建主干 dist 并跑冒烟。
- 分级合并规则表放入受保护路径，判据由需求文本改为 diff 文件列表、守门测试结果和「先红后绿」证据。
- 开发循环为每条流写本地 span 树（`.kunpeng/spans/<flowId>.jsonl`）；新增回滚归因分类与热图、每美元产出看板（`cost-report --by-harness`）、`escape-rate` 的「疑似逃逸」列。
- 派流前的确定性检查：`kunpeng run` 派 spec 文件前先跑 spec-lint；新增「点名的测试不存在 / 锚点文件不存在 / 验收件语法错误 / vitest 没清后端变量」四类检查与回滚风险打分；同一类驳回或回滚原因出现 3 次以上会自动变成 spec-lint 规则。
- 独立评估器：verify 阶段用与实现者不同的后端只读复核，结论为三值；判不定时挂人工门，可按项目开关。
- 自进化提案需要带可证伪的预测，采纳满一个窗口后用流数据复核，预测没兑现就生成回滚提案草稿。
- 技能固化前做确定性安全扫描；`skill pack` 按 Agent Skills 标准打包（只构建，不发布）；新增 `kunpeng spec-import`，可把 spec-kit / OpenSpec 转成鲲鹏 spec 骨架。
- 本机会话采集（Beacon 模式）：`lessons harvest` 从 Claude Code / Codex 会话中提取纠错与调试模式，作为待验真的候选教训。
- 执行后端抽象第一步：agent 进程可以配置为在本机 Docker 容器中运行。
- 自建的五个 MCP server 同时兼容 MCP 2026-07-28 与旧版 initialize 握手。
- 对话模型下拉新增 Opus 5.5（`claude-opus-5-5`）。
- 入库技能 `skills/seo-audit`（SEO 与 AI 可见性诊断审计）。

### Changed
- 角色门改为显式能力表，默认拒绝；`read` 能力恢复为纯只读，反馈与收件箱的写操作分别改标 `dispatch` / `chat`。
- 凭据改为默认拒绝的白名单：agent 子进程与验收命令只拿到白名单内的环境变量。
- 取消 codex 沙箱豁免；每个工作区使用独立的 dist 与临时目录。
- 判死机制分三级（租约 + 心跳），能给出归因并清理孤儿进程；流状态写入使用乐观版本号（CAS）。
- 预算接入每条流；计价链修正；收据字段补齐并回填历史缺失。
- 运营门等级取自运营 loop 的杠杆设置，不再写死 L2；「饿死」告警只在上游有活却一直喂不进来时才报。
- 鲲鹏 HOME 收敛为单一来源（`util/kunpeng-home.ts`），对话不再回落到 `homedir()`。
- 通用 helper（`escapeHtml` / `isNodeError` / `errorMessage` / `isRecord` / `readJsonBody`）收拢到单一来源，并加守门测试。
- 源码文件体量增量闸：清单外的源文件不得超过 600 行。
- 测试目录纳入类型检查（`tsconfig.test.json`），存量类型错误清零。
- 运行时归档 `.kunpeng/state-archive` 不再由 git 跟踪（改为由本机备份覆盖）。
- 每日 maintain 原地截断 `~/.kunpeng/logs` 下的大日志，保留 inode 不变。

### Removed
- 进化提案的机器自动批准通道：提案只能由人批准。
- 5 个只被测试引用、已被取代的导出。

### Fixed
- 总览聚合只用第一个项目做底座，导致其它项目的门不显示。
- 标记 rolled-back 失败时不再静默吞掉错误；4 处同步子进程补上超时。
- ACP 读取 stdin 改为流式 UTF-8 解码，多字节字符跨块不再乱码。
- `kunpeng run` 读不到 `.md` spec 时报错退出，相对路径先按 `--repo` 解析。
- 工作台「出问题」栏不再显示 `[object Object]`。
- 回归库隔离告警与状态目录非流文件告警各汇总成一行，不再逐条刷屏。
- FlowTracker 写锁不再落到公共临时根目录（偶发失败的测试）。
- Telegram 拒绝合并门时，清门失败不再被静默吞掉。

### Security
- 派流接口拒收非 owner 的自定义验收命令，验收命令的执行环境去掉宿主凭据；member 未设宿主权限上限时默认 isolated。
- 写接口统一校验来源（防 CSRF）：鉴权后所有非 GET 的 `/api` 请求只接受同源。
- 改密码后，此前签发的会话全部失效。
- 知识库 URL 抓取与 copy-ref 逐跳经过 SSRF 闸，并加超时与响应体上限；SSRF 闸补齐保留地址段与 IPv6 内嵌 IPv4。
- 自动合并敏感清单补上鉴权中间件、鉴权前路由、bypass 拼装、组装门禁与权限上限执行点等文件，改动这些文件必须停在人工门。
- 工作区 say / events / gate 三个入口对 member 拒绝；通用批准路由按 artifact 类型拒收，堵住 L4 发布绕过二次确认。
- prompt-shield 的「下载即执行」与「已知外传域名」两类硬拦补上行为测试，并补检 markdown 围栏、前缀写法、撇号与引用块等绕过写法。
- publicSurface 闸在配置写坏时改为保守拦截。
- `/healthz` 免登录只返回 `{ok}`，Dockerfile HEALTHCHECK 改为探测 `/healthz`。
- 会话采集脱敏补上 JSON 键与连接串。

## [1.1.0] - 2026-09-14

### Added
- `kunpeng auth add-user <名> [--role owner|member] [--profile <id>]`:新增驾驶舱登录用户,走 `addAccount()` 追加语义,重名拒绝且不写文件。此前 CLI 侧只有 `set-password`,而"加用户"这条路径压根不存在(驾驶舱 `/api/accounts` 早已接对,是 CLI 缺接线)。密码仍只从 `KUNPENG_AUTH_PASSWORD` 或 stdin 读,不接受命令行参数。
- 会话面板模型下拉新增 `claude-opus-5` 与 `claude-opus-5[1m]`(1M 上下文变体);上下文水位判据识别 `[1m]` 后按 1M 窗口计算。
- `orchestrator/src/project/state-dir.ts`:`kunpengStateDir()` 唯一实现,`profile.ts` / `registry.ts` 改为再导出;空串与纯空白的 `KUNPENG_STATE` 统一视作未设置。
- lint 接入自建循环验证链:`assembleChecks` 新增 `{lint?: boolean}` 开关,按项目通过 `.kunpeng/checks.json` 显式开启(默认关闭,不影响其它已注册项目);本仓已开启。
- `npm run verify` 脚本(lint + typecheck + test 一次跑完)。
- `SECURITY.md`:漏洞披露方式、响应时限与支持范围说明。
- README 新增「许可与支持」章节,指向 LICENSE / SECURITY.md / THIRD-PARTY-NOTICES 与客户帮助中心。
- Docker 镜像加固:以非 root 的 `node` 用户运行,并加入 HEALTHCHECK。

### Fixed
- **P0 数据丢失**:`kunpeng auth set-password` 会静默删光整张账号表。它用 `buildAuthConfig()` 的返回值整体覆写 `auth.json`,而该函数返回的 `accounts` 是单元素数组——于是"给某人改密码"实际是"把账号表替换成只剩这一个人",且照常打印成功提示、无任何警告。`--user` 打错一个字母(或指向尚不存在的用户)即触发,后果是所有人被锁在驾驶舱外。实测复现:4 个用户执行一次后只剩 1 个。改为走 `editAccount()` 只重置**已存在**用户,用户不存在时拒绝执行且**不写文件**;`auth.json` 不存在时(首启初始化)仍走 `buildAuthConfig` 建单账号。
- `auth` 命令的所有错误分支由 `process.exit(1)` 改为 `process.exitCode = 1` + `return`。原来的 `process.exit` 会直接杀死调用方进程,使这些分支无法被测试覆盖——上述删账号缺陷能长期潜伏,根因之一就是它测不到。
- 删除 `auth set-password` 成功提示里"cockpit 重启后生效"的错误说法:`auth.json` 是每次请求现读的,新增/改密后无需重启 serve 即可登录(已对运行中的 serve 实测)。
- **P0 交付阻断**:照 `docs/runbooks/install.md` 执行 `docker compose up` 后总控台返回 403「远程访问需配置 auth.json 鉴权」,客户无法进入。根因是 `docker-compose.yml` 默认设置 `KUNPENG_ALLOW_INSECURE=1`,使 serve 跳过首启密码向导而不生成 `auth.json`,而容器内请求源 IP 为 docker 网关(非回环)因此被判 `forbidden-remote`。移除该默认值后走首启随机密码路径,已实测登录成功并进入总控台。
- `taskboard/lock.ts` 在 `finally` 中 `throw`,会用「目录锁清理失败」覆盖 `fn()` 抛出的原始业务异常,导致真实失败原因永久丢失;改为记录告警不再抛出,`handle.close()` 同样加保护,获取锁超时错误补 `cause`。
- 对话历史、chat-mcp 配置、上传目录、更新通道与更新包共 5 处写死 `~/.kunpeng`,完全无视 `KUNPENG_STATE`,与 `docs/runbooks/env-vars.md` 契约不符;统一改走 `kunpengStateDir()`。
- `orchestrator/package.json` 版本停留在 `0.1.0`,而 CHANGELOG 已标记 `1.0.0` 发布,导致客户执行 `kunpeng version` 与文档不一致;版本号对齐为 `1.1.0`。
- 客户按文档复制的环境文件未被 `.gitignore` 覆盖,存在误提交密钥风险。
- `notify.json` 与断点续跑 `meta.json` 由直接写入改为原子写(临时文件 + rename),避免进程中途被杀留下半截 JSON。
- 手机端(≤768px)触控目标过小:模型/保留期下拉 24px、发送按钮 30px、敏感与本地目录 chip 26px、帮助图标 15px、多处输入框 20px、设置页下拉 19px。统一抬到 32~36px,过小控件由约 30 个降至 3 个;工作台对话窗标题栏由 12 行压至 8 行。
- eslint 全仓 156 处问题(80 error)清零,含拆分单体后遗留的 8 个未使用 import 与一批仅被导出而无人引用的死代码。

### Changed
- 62 个仅在本文件内使用却对外导出的运行时符号收敛为文件私有,缩小公共 API 面(recipe 常量靠同文件自注册,只去 `export` 不删符号)。
- `DashboardState`(58 字段、115 个消费者文件)与 `DevCycleDeps`(27 成员)按语义拆为内聚子接口再 `extends` 合成,解析后的类型逐字段等价,消费者无需改动。

- cockpit 设置页账号管理增删改:editAccount 纯函数(改名/切角色/改 profile/重置密码,守卫=目标存在/改名不碰撞/最后 owner 不可降级/不可变) + PATCH /api/accounts(owner-only 由 authz.ts ACCOUNT_ADMIN_PREFIX 统一拦截,salt 路由层 randomBytes 仅 newPassword 时生成) + deleteAccount(最后 owner 守卫 + 路由层挡删当前登录账号) + 前端账号编辑内联面板;文档见 docs/product/2026-06-22-cockpit-account-management.html 与 docs/design/2026-06-22-account-management-tech.md
- cockpit 设置页五组手风琴(账号/通讯/后端路由/运行状态/偏好,点标题展开收起,默认只展开账号)
- cockpit 设置页「修改密码」(src/server/auth-change.ts 纯逻辑:验当前密码+保留旧 secret 不踢会话+新密≥8位 / POST /api/auth/change-password 已鉴权端点 / 设置页表单 + client 接线;中间件每请求读 auth→改完下次请求即生效无需重启)
- 概览接入 loop / evolution / F-07 度量三面板(renderMetricsPanel 自动完成率vs80%目标+token趋势+3门守恒 / renderEvolutionPanel 待审·已批·提案摘要 / renderLoopHealthPanel 指标·波次·下一杠杆),数据来自已采集的 DashboardState 字段,真数据核对(自动完成96%/已批3)
- cockpit 多工作区切换器(shell 顶栏常驻 select,选定工作区跳 #/project/<id>、全部工作区回 #/overview;client 端 change→hash + 导航同步选中,跨视图常驻)
- 项目档案层:dossier/ADR/CHANGELOG 三件落地
- CLI 直跑的流也落日志(治本,驾驶舱「日志」对终端流也有内容)
- kunpeng dossier 生成/刷新 PROJECT.md 单一事实源
- kunpeng adr 决策日志(五要素+被取代链)
- kunpeng kb 跨项目知识库聚合索引
- 产品轨产物落人读 markdown 标准位 docs/product/<slug>/
- product VALIDATE 闭环自动生成决策 ADR(inconclusive 不落)
- PROJECT.md 接 writeBoard 自动刷新(opt-in)
- kunpeng spec-index(spec 散落可见+supersedes 串链)
- kunpeng version(SemVer+CHANGELOG 滚版本节)
- kb 跨项目聚合接进 cockpit(/api/kb+按钮+overlay)
- spec-index 增加特性族分组(同前缀聚类,功能分解可见)
- OST 深接进 product discover(产机会-解法树+validateOst+落 ost-tree.json)
- cockpit 账号密码登录(scrypt+HMAC cookie, kunpeng auth set-password, auth.json存在才启用)
- cockpit 远程访问上线:Cloudflare Tunnel 固定域名 cockpit.aeohq.io + 三服务自启 + 运维笔记
- 概览重设计:战略面板(北极星/方案vs进度)+档案面板(变更/决策/特性族)接进 cockpit 概览
- switchboard 实时推送(SSE):替 15s 轮询,cockpit 消息实时收发(零依赖)

### Fixed
- cockpit 概览/首页慢(1.4~1.9s)根治:profile 登录路径 snapshotsForProjects 曾串行且无缓存逐项目全量 collectState,改 Promise.all 并行 + collectStateCached(TTL+single-flight,与 collectMultiState 同款);collectProjectDashboardState 同步走缓存。实测冷击 0.6s、缓存命中 11ms(05364db4;补 P1 状态缓存欠账。注:本条为手改直落未走自建 loop,已被用户点名"记得 loop",下不为例)
- 工作台聊天/命令面板中文输入法选词回车误发送:keydown 加 isComposing/keyCode 229 守卫,组合态回车只确认候选词不触发 send(真浏览器验证:组合态 Enter 文本原地不动)
- 工作台对话偶发整场日文:全汉字短问题被模型判成日文 + 历史回放把首句漂移污染成整场;buildChatPrompt 末尾(紧贴生成点)加语言规则钉死简体中文
- 范围门聚合所有 `scope` 块(scope-gate.ts:parseScopeDeclaration 从 `.exec` 首块改 `matchAll` 全块并集 allow/forbid,无块才返 undefined)+多块测试;根治「spec 多个 scope 块只认第一个、后续 flow 文件被误判 outside-allow」的限制
- 修 6 个陈旧基线测试对齐已落地实现(纯测试侧零生产改动):tokens-by-model(对齐 src/agent/model-routing.ts:codex implement=high/claude 完整 model-id) / architecture-view(图迁 Cytoscape #cy-arch) / settings-theme(外观→偏好) / auth+auth-change+auth-middleware(多账号签名:signSession+profileId/buildAuthConfig 返{accounts}/verifyPassword 收 AccountRecord)
- 修 CLI 旗标值泄漏进位置参数
- 修 capture HTML 摘要质量(先转纯文本,治摘要=< / tags=div/span)

### Changed
- 鲲鹏产品化战略(App+多租户SaaS)定版+ADR-0005相位上市决策

### Removed
- 删 4 个重构后遗留的 re-export shim 死代码(product/{discover,shape,validate}.ts → 真身 product/stages.ts;server/views/loops.ts → 真身 server/ui/views/loops.ts):零业务逻辑、无 importer,功能全保留;走自建 loop(spec=claude→implement=codex→verify)产出 + 隔离 worktree 真 typecheck 验证后合并

## [1.0.0] - 2026-07-24

首个正式版本冻结商业化交付基线，覆盖从本地安装、受控执行到运维恢复的完整路径。

### 新增

- 完成安装与打包链路，统一版本来源、构建锁和可发布产物边界，降低并发构建与环境差异带来的交付风险。
- 知识库中央化到按 remote 分键的 captures 仓库，并补齐合规资料落库、跨项目检索和备份恢复说明。
- 补充项目档案、ADR、标准产物索引和 CHANGELOG 治理，使功能、决策与版本证据可以追溯。
- 为持久化数据加入 `schemaVersion` 演进保险，让后续格式升级能够显式识别、迁移或拒绝不兼容状态。

### 修复

- 修复会话续接、刷新恢复、输入法误发送和语言漂移等问题，使长会话与重连路径保持一致。
- 加固 loop 的范围门、验证门、并发写入、分支隔离和失败恢复，减少假绿、状态竞争与跨 flow 污染。
- 强化终端会话的存活检测、超时、回收和日志接线，使异常退出可见且不会长期遗留失控进程。
- 修复中央知识库采集、索引和摘要链路中的路径与内容处理问题，确保资料能稳定落库并再次查回。

### 安全

- 首次启动要求显式设置认证口令，认证配置采用派生 hash；错误响应与日志统一脱敏，避免泄露凭证、会话和本机路径。
- localfs 增加账号、会话、浏览器来源的 owner 校验、7 天授权过期和严格归属模式，防止不同用户或设备接管目录。
- 收紧终端、文件访问、外部输入和发布边界；危险操作 fail-closed，对外发布及已登录后台操作继续经过人工门。
- 合规记录采用标准产物持久化并保留真实验证证据，敏感配置不进入安装包、公开仓库或知识库正文。

## [0.1.0] - 2026-06-14

里程碑 M0–M3 基座 + 三块升级（Block-1 项目身份与接管层 / Block-D 工程硬化 / Block-A 方案接入 + Concierge 分解）首个标注版本。

### Block-A · 方案接入 + Concierge 分解

#### Added
- 新增 `kunpeng plan <方案.md>`：读外部方案 → 确定性自适应分解（最浅 H2+ 标题=阶段、深一层标题/checklist=flow）→ 验收提取（` ```accept `/`验收:`）或小 agent 翻译 + 弱测试审计（C3）→ 阶段化执行：段内并行单写者、段间顺序经每 plan 集成分支 `kp/plan-<id>`（绝不碰 main）、失败即停段、全过挂终点「合并主干」单门。
- dashboard 按 `planId` 归组显示每阶段进度。

#### Changed
- 抽共享 `git/merge.ts` `safeMerge`（plan 集成与人工门 merge 共用）；`Workspace.acquire` 支持从指定 base 分叉；`FlowState` 加 `planId`/`phase`；`DevCycle` 加 `planContext`。
- 版本号改为单一来源（`package.json`），消除 `src/index.ts` 硬编码漂移（#3）。

### Block-D · 工程硬化

#### Changed
- 消除 `as any`，收紧类型；新增 `typecheck` 脚本（`tsc --noEmit`）。
- 显式声明 public API surface（`src/index.ts`）；`package.json` 的 `exports` 封锁深链 dist 子路径，未导出模块一律视为 internal。

#### Added
- 新增 `orchestrator/README.md`（一句话定位、命令一览、环境变量、架构速览、边界）与本 `CHANGELOG.md`（Keep a Changelog）。
- 引入 lint + CI 与协作约定文档。

---

### Block-1 · 项目身份与接管层（2026-06-14）

从「单库后台」走向「数字研发团队 org」——一个鲲鹏统一总控多个纳管项目。

#### Added
- **中央注册表** `$KUNPENG_STATE/projects.json`（默认 `~/.kunpeng/`，可枚举全部项目）+ **repo 自描** `<repo>/.kunpeng/project.json`（子 agent 无需中央表也能自证身份）。
- 新命令 `register` / `projects` / `onboard`：接管声明用单一可信源 `onboard.tmpl.md`（`{{name}}` 渲染、fail-closed），id 取自 repo 目录名，register 幂等。
- **多项目统一总控台**：dashboard 拆为 `state.ts`（`collectState` + 多项目 `collectMultiState` 聚合）/ `page.ts`（多项目分组 HTML）/ `http.ts`（server + 人工门）；给 `--repo` 时退回单项目模式（向后兼容）。
- `KUNPENG_STATE`（运行态目录）与只读 `KUNPENG_HOME`（宪法源）解耦。

#### Changed
- 人工门按 `projectId` 隔离回写：merge/approve 携带 projectId，server 据此定位 repo，动作绝不串项目。
- `dashboard.ts` 降为 barrel，保旧 import 不破。

#### Fixed
- 注册表元素形状校验 + 原子写（防半截写坏表）。
- `collectMultiState` 按项目隔离失败：单项目采集出错只产降级快照带 `error`，不拖垮整盘；失败项目显示「加载失败」横幅，不再伪装成空。

---

### 差分验证 + 方案带验收（2026-06-13 ～ 2026-06-14）

真机桥接一个真实线上项目逼出的两项关键升级。

#### Added
- **差分验证**：真项目基线常本就红，验证门只拦「基线之外的新错」（`newFailures`：实现前抓基线、实现后对比），不要求整库全绿。
- **`--accept`**：方案直接带来精确验收命令，实现者不得自行弱化（C3，P1 种子）。

#### Fixed
- 修正 spec 自拟 grep 验收误杀（如 `\bcache\b` 撞 `ai-cache` 路径）——改由方案带验收命令。

---

### 协作安全合并（2026-06-14）

#### Changed
- 合并改为走**临时 worktree**，绝不在共享工作树上 `git checkout` 切分支——不夺外部 agent 的工作区。
- 子 agent 继承并遵守目标库现有 `AGENTS.md`/`CLAUDE.md`；冲突即中止并归人工门，不强行合并。

#### Added
- `COORDINATION.md`：多 agent 协作协议（活跃流可见、冲突归 git 人工门）。

#### Fixed
- 修正旧 build 在共享工作树上 `git checkout main` 夺外部 agent 工作区的根因（长驻服务须在合并逻辑升级后重启到新 build）。

---

### M3 · 构建发布 + 文档治理（2026-06-13）

#### Added
- `release` 命令：跑构建命令，成功记为发布就绪、失败记为 rolled-back，归档为 release 产物。
- `doc` 命令：把产物库编译成文档索引（`.kunpeng/DOCS.md`）。

---

### M2 · 自我进化（四护栏）（2026-06-13）

#### Added
- `evolve` 命令：消费经验产物生成自我进化提案。
- 四护栏（C6）：只提案不自动固化、提案带 diff + 理由 + 经验来源（per-change provenance）、只改 conventions、命中 core 一律拒、经验入库前验真（防投毒），固化需人工门 #2。

---

### M1 · 守护循环（2026-06-13）

#### Added
- `guard` 命令：确定性扫描器（C8）——目标库真实 `typecheck`(error) / `lint`(warn) + TODO 扫描，结果存为 review 产物。
- guardian 逐行解析；区分 grep exit 1（无匹配，正常）与 exit>1（真错误），不吞崩溃。

---

### M0 · 基座（2026-06-13）

底座从 0 到「全面技术后台」雏形。

#### Added
- **产物 store + 状态机**（C2）：标准产物（spec/plan/task/review/experience/proposal/release）落盘流转，状态转移受 `TRANSITIONS` 约束。
- **单写者 worktree**（C1）：每条 flow 独立 git worktree 隔离，写锁单一。
- **验证门**：跑真实验证命令、附证据（C3）。
- **主开发循环** `run`（dev-cycle）：spec → 测试审计 → 实现 → 验证 → 提交 `kp/<flow>` 的确定性状态机。
- **测试审计角色**：确定性闸门拦弱测试（只查存在/恒真的验收命令）。
- **AGENTS.md 编译** `compile`：把宪法 stamp 进目标库，幂等、非覆盖别人的文件。
- **CliRunner 双后端**：登录态 CLI 起子 agent（`claude` 默认 / `codex`，`KUNPENG_BACKEND`），零 API key，调用带超时硬保护。
- **桥接真项目**：`--repo` / `KUNPENG_HOME` 解耦；验证/守护用项目真实 `typecheck/lint/build`。
- **运营总控台** `serve`：全流程红绿灯 / agent@阶段 / ETA / 卡点 / 可操作人工门（`runtime/flowstate.ts` 打点）。

#### Fixed
- experience id 唯一化、provenance 精确、proposal/release kind 拆分、后端调用超时硬保护。
