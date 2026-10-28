# 鲲鹏 1.2.0 能力与代码实现导读

> 面向研发，依据本目录 `orchestrator/src`、`package.json`、`CHANGELOG.md` 静态核对，2026-10-22。本文以**可执行调用链和关键函数**为说明单位；仓库有约 882 个 TypeScript 源文件，逐行解释全部文件并不能帮助理解系统行为。这里完整覆盖 1.2.0 版本日志列出的能力类别，并给出继续追到代码的入口。本文不把源码存在等同于真实环境已经部署或验证。当前目录还含 `[Unreleased]` 改动，见第 13 节。

## 1. 系统整体：输入如何变成结果

鲲鹏是一套 AI 研发与运营编排器。核心路径是：`CLI / 驾驶舱 / ACP → 项目身份与策略 → spec/plan → 隔离 worktree 中的开发流 → 验收和差分验证 → verified 产物与人工合并门 → 合并后状态、经验、目标和运营反馈`。另一条运营路径是 `playbook/loop → 到期判断与策略门 → recipe 波次 → 台账/报告/缺口任务`。知识库、技能、插件、MCP、SEO/GEO 是这些路径的可选数据和能力接口。

代码从 `orchestrator/src/cli.ts` 启动。它通过导入 `cli-commands/*.ts` 注册命令；`main()` 解析全局参数、确定 repo 与鲲鹏 HOME、检查 flow 内递归派发 `run/plan`、刷新 presence，最后交 `dispatchCliCommand()`。命令实现按领域拆在 `cli-commands/`，不要把 `cli.ts` 的命令清单当成每个命令的实现。`orchestrator/package.json` 把版本定为 `1.2.0`，构建产物入口是 `dist/cli.js`。源码见 `orchestrator/src/cli.ts:1-190`、`orchestrator/src/cli-commands/registry.ts`。

运行时有四类持久化事实：`.kunpeng/artifacts` 的 spec/plan/review/experience/proposal 等标准产物，`.kunpeng/state` 的 flow 状态与人工门，`.kunpeng/loops` 的运营定义和波次，以及 `~/.kunpeng` 中跨项目的注册、账号和总机状态。`ArtifactStore` 用 Zod 校验形状及 `TRANSITIONS` 约束状态跃迁；读取清单时坏单项告警并跳过，避免整张驾驶舱报表崩掉。源码见 `orchestrator/src/artifacts/{types,store}.ts`、`orchestrator/src/runtime/flowstate.ts`。

## 2. 方案驱动开发：`run`、`plan`、单写者与产物

**入口。** `run` 的命令入口在 `cli-commands/devcycle.ts:193`；`plan` 在 `cli-commands/loop-core.ts:518`。`plan/parse.ts` 按 Markdown 标题形成 phase/flow，`plan/orchestrator.ts:119` 创建 `kp/plan-<id>` 集成分支；同一 phase 里由 `runPool()` 有界并行，下一 phase 从上一 phase 的集成分支开始。每条 flow 由 `DevCycle` 执行，阶段结果进入 `FlowTracker`、`ArtifactStore`；整条 plan 在集成分支上做跨流检查，终点只挂一次主干合并人工门。源码见 `orchestrator/src/plan/{parse,pool,orchestrator}.ts`。

**每条 flow 的状态机。** `DevCycle.run()` 建立根 span，`runFlow()` 先拿并发槽、预算和 tracker，再由 `Workspace.acquire()` 取隔离 worktree。它在 worktree 内生成或恢复 spec；验收命令优先用作者传入的 `acceptanceCmd`，否则用 spec 阶段给出的命令。作者文件块在实现前从需求/spec 固化到内存，验证前恢复，防止实现者改弱测试。随后做验收审计、基线采样、可选先红验证，再让实现者写代码。实现后检查评测资产和 scope，运行验收、类型检查等验证；失败可按配置修复重试；通过后提交、写 verified 与经验产物，独立 flow 留下合并门。预算耗尽、agent 主动 `RAISE_BLOCKER`、停止信号都会记录状态和可续跑点。源码见 `orchestrator/src/loop/dev-cycle.ts:314-1110`。

**隔离与单写者。** `git/workspace.ts` 管 flow worktree 的取得、续跑、释放与回滚；不同 flow 的写工作区不共用。`cli.ts:53-68` 还用环境标记和 `.kunpeng/wt/` 路径阻止 flow 内 agent 再派发 `run/plan`，`DevCycle` 在提示词末尾补同一条约束。这样顶层“改鲲鹏必须走 loop”不会让 loop 内实现者递归启动新 loop。

**派流前检查。** `plan/spec-lint.ts:178` 解析 Markdown 围栏、`scope`、`accept`、作者文件块；检查点名测试与锚点路径是否存在、验收件语法、弱断言和已有测试的消费关系。`scope-gate.ts:19,162` 把 `allow/forbid` glob 转成改动文件判定，非法 scope fail-closed。`eval-asset-guard.ts:17-72` 对被实现者触及的测试目录、验证门、回归库和验收命令引用文件做独立检查；只有作者文件或 scope 显式放行才豁免。1.2.0 的新增重点是把这些检查提前到派流前，并把重复驳回/回滚原因转成后续规则。源码见 `orchestrator/src/plan/spec-lint.ts`、`orchestrator/src/verify/{scope-gate,eval-asset-guard,red-first}.ts`、`orchestrator/src/metrics/rollback-recurrence.ts`。

**验证口径。** `verify/gate.ts:14` 以清理宿主凭据后的环境执行验收命令，默认超时 120 秒。`newFailures():137` 将前后输出归一化，去掉 ANSI 色码、临时路径/ID、时间和通过行，只比较错误形态；因此“基线本来就红”不会自动使新流失败。`plan/orchestrator.ts:38` 在集成分支再次跑项目检查，并对基线做差分确认，补单流验收漏掉的跨文件/跨流问题。`DevCycle` 同时记录真实输出、diff 统计、回滚原因及 span；没有输出的失败用 trace 和重定向文件尾部帮助诊断。差分绿只表示未发现新增错误，仍须通过锁定验收与人工合并门。

## 3. 独立评估器和合并门

**只读复核。** 项目启用 verify evaluator 时，`DevCycle` 在机械验收后读取本流 diff 与验收输出，把需求、spec、diff、输出交给 `verify/evaluator.ts` 组成只读输入；调用时要求避开实现后端，工具列表为空。结果只有 `pass/fail/inconclusive`：`fail` 回滚；独立 flow 的 `inconclusive` 挂人工确认门；不可解析或空输出也归 `inconclusive`。评估器结果与所用后端写进产物元数据。源码见 `orchestrator/src/loop/dev-cycle.ts:1003-1060`、`orchestrator/src/verify/evaluator.ts`。它是可配置能力，不能假定所有流都跑了此门。

**主干合并。** 人批准后，`mergeAndClearGate()` 先跑守门测试；变红时保留人工门。随后在仓库级文件锁内检查停止信号、敏感路径、差分审查、分支刷新、过时删除、变更日志等，再用安全合并路径写入主干。失败、冲突或判不定均保留门，不会假装已经合并。`reviewMergeDiff()` 从真实 diff 检查空改动、保护文件、二进制、冲突标记和密钥；带 `file:line` 与证据的预审 `normal` 发现进入阻断，`nit/pre_existing` 只随结果展示。源码见 `orchestrator/src/runtime/{merge-gate,merge-review}.ts`、`orchestrator/src/git/{refresh-branch,merge-main-atomic}.ts`。

**1.2.0 的加固。** 版本新增守门测试“碰红”记录、合并规则按 diff 文件清单和先红后绿证据判定、合并后重建主干 dist 并做冒烟。相关代码入口在 `runtime/merge-gate.ts`、`runtime/merge-guard-tests.ts`、`runtime/sensitive-paths.ts`、`git/merge-main-atomic.ts`、`runtime/post-merge-build.ts`。是否自动合并还受人工门和敏感路径规则限制；`verified` 只表示流验证通过，不表示已经在 `main`。

## 4. 决策收件箱与 L0–L4 动作策略

`policy/action-levels.ts` 是等级单一来源：L0 只读、L1 草稿、L2 有界可逆改动、L3 对外可见可逆、L4 对外可见且不可逆或花钱。`classifyActionLevel()` 按只读/草稿/外部可见/可逆/花钱标志定级；L3/L4 需要人工门，L4 需要二次确认；合成证据最多推动 L1。`policy/requirements.ts` 再按 `shell/file/network/publish` 设 `deny/ask/allow` 第二维，解析非法配置会失败；defaults 与 spec 可覆盖缺省，但内建发布底线和 requirements 只能把策略压得更严，L3/L4 不吃“记住的批准”。

收件箱不是一张独立任务表。`state-snapshot-aggregates.ts:171` 从各项目 flow 门、提案、运营门、告警等快照组装 `ReviewItem`，按影响范围、预审意见、过期状态排序，应用每项目每日硬门配额及 TTL，并支持 owner 归属。`inbox-triage.ts:60` 根据条目来源、预审发现和等级给出“建议放行 / 需要判断 / 建议驳回”及缺失信息；这个建议不能代替人工批准。暂缓、已读、驳回等状态由相应 store 持久化。源码见 `orchestrator/src/server/{state-snapshot-aggregates,inbox-triage,inbox-policy,inbox-defer-store,inbox-dismiss-store}.ts`。

运营的 L3/L4 采用一次性批条：`ops-gate.ts:49` 建 pending 门，`decideOpsGate():105` 只接受 `by:"human"` 的裁决并追加审计行，`consumeApprovedOpsGate():71` 按 loop 和足够等级找最早未消费批准，消费后不再复用。1.2.0 的 L4 服务端二次确认与拒收合成证据，在收件箱/API 的决策路由和 `policy/action-levels.ts` 联合落实。源码见 `orchestrator/src/loop/ops-gate.ts`、`orchestrator/src/server/routes/`。

## 5. 目标对象与人工复盘

`GoalStore` 把每个目标作为 `.kunpeng/goals/<id>.json`，用 Zod 校验、文件锁串行写和原子替换。`create()` 拒绝重名，记录创建序和历史；`setStatus/setCurrent/setTarget` 都追加操作史；损坏的历史目标文件告警后跳过。flow 可带 `goalId`，否则归入“未归属”；驾驶舱和周报按目标聚合。源码见 `orchestrator/src/goals/store.ts:7-211`、`orchestrator/src/cli-commands/goals.ts`。

`buildGoalReviewFacts()` 在时间窗内只取该目标的 flow，算 total、verified、rolledBack、USD 和改动文件数；`runGoalReview()` 分两次只读 agent 调用：先要求“进展与证据”，再根据这份证据提出下一期量化 target。两份 JSON 都校验形状；第二步失败会留下 `proposalError`，不替用户更新目标。`acceptGoalReview()` 只在草稿有合法提案时改目标并记录裁决者；`rejectGoalReview()` 只改复盘状态。源码见 `orchestrator/src/goals/review.ts:36-237`。

## 6. 运营 loop、playbook 与波次护栏

运营定义在 `loop/store.ts`，recipe 注册在 `loop/recipe.ts`；`ops-run.ts:7-30` 把 `daily/monthly/every:<n>h|d|w` 变为到期间隔，缺省周频。调度器只挑到期且有 `loopId` 的 playbook；`ops-lock.ts` 防止同一 loop 重入，台账记录每波真实结果。`loop/driver.ts:128` 先检查杠杆存在、目标项目、护栏与动作等级；需要 L3/L4 时先消费有效批条，否则只建门并返回；之后才调用 recipe `runWave()`，更新指标、报告、缺口与经验。

`ops-guard.ts` 用过去动作台账判断熔断：默认最近 30 波，至少 3 样本、失败率 ≥80% 则停止；另外对波次文本的发布、删除、付费、生产、凭证词和近 30 天 token 预算检查。观测型指标以 `verified` 判成功，普通指标以 `metricDelta>0 && verified` 判进展；仪器故障波次不进入失败率。`ops-pilot.ts` 给可消费技能的 recipe 提出下一杠杆和技能；不接受技能的 recipe 显式忽略。源码见 `orchestrator/src/loop/{ops-run,ops-lock,driver,ops-guard,ops-pilot,action-ledger}.ts`。

GEO 监测是其中一个 recipe：固定题集逐题调用带 `websearch` 的 agent，解析引用 URL/品牌域名，输出每波 JSON 和提及数，并为前五个无提及问题建去重缺口任务。它与客户版 GEO 审计不是同一评分链。完整规则见 [GEO 审计实现说明](2026-10-22-kunpeng-geo-audit-implementation.md)，源码 `orchestrator/src/loop/recipes/geo-monitor/{core,runwave}.ts`。

## 7. 自我进化与可证伪预测

`loop/self-evolution.ts` 从真实 experience 形成 proposal；`evolution/route.ts` 把建议分流。提案只到草稿/待批，修改宪法或角色卡要人工门 #2；`evolution/policy.ts` 拦核心文件与危险命令。`eval-runner.ts`、`fitness.ts`、`product-kpi.ts` 用回归/holdout、成本、已验证流和产品指标评估候选；判定结果是证据，不会自动替人固化治理规则。源码见 `orchestrator/src/loop/self-evolution.ts`、`orchestrator/src/evolution/{route,policy,eval-runner,fitness,product-kpi}.ts`。

1.2.0 要求每条拟采纳改动带预测：指标仅 `verifiedRate/rollbackTokenShare/tokensPerVerified`，写方向、最小变化和 1–60 天观察窗；`parsePrediction()` 拒无效字段。窗口满后 `judgePrediction()` 比较采纳前后等长窗口的真实终结 flow，剔除 plan 壳流，任一侧少于 5 条记样本不足；未达最小变化标 missed。`checkAdoptedPredictions()` 把结果写回提案元数据，missed 时写 `revert-<proposalId>` 草稿，仍需人工决定。源码见 `orchestrator/src/evolution/{prediction,prediction-check}.ts`。

## 8. 知识库、会话采集与技能

`capture` 在 `knowledge/capture-cli.ts` 处理文件、URL 或文本并落入 `CaptureStore`；`retrieve.ts` 做检索排序，`recall.ts` 给后续任务返回命中资料。开发流只注入与当前需求相关的少量经验，避免整库进上下文。`lessons harvest` 是 1.2.0 的本机会话采集：`parseClaudeSession/parseCodexSession` 把 JSONL 统一为事件；`extractCandidates()` 只识别“工具报错后同名工具在 12 个事件内成功”和“用户明确纠正 assistant”两类；`redactSensitive()` 在落盘前脱敏；高风险注入丢弃，其余以不可信包裹和 `trustTier:0` 入待验真经验。它只在显式调用时扫描本机。源码见 `orchestrator/src/knowledge/{capture-cli,capture-store,retrieve,recall,session-harvest}.ts`。

技能管理由 `skills/registry.ts` 登记。`scanSkillSafety()` 用确定性正则和 prompt 注入分类识别跳过 hook、强推、改核心宪法、越权权限、下载执行与密钥外传；区分硬拦与提示，并识别同分句否定语境。`packSkills()` 校验 Agent Skills 元信息、扫描文件、复制资源并生成每文件 SHA-256 manifest，只在本地构建，不负责发布。`spec-import` 可机械转换 spec-kit/OpenSpec，但故意不补 `scope` 和作者 accept，让 `spec-lint` 在作者写验收前拒绝派流。源码见 `orchestrator/src/skills/{skill-safety,skill-pack}.ts`、`orchestrator/src/spec/import-external.ts`。

## 9. 执行后端、凭据和通信协议

`AgentRunner` 是 agent 执行契约；`cli-runner.ts` 以已登录的 Claude/Codex CLI 调用不同 stage，记录输出、token 和后端，配超时。1.2.0 加了本机 Docker 进程后端的第一层抽象：`dockerRunArgs()` 检查 worktree 在容器共享根内，以宿主 UID/GID 挂载同路径，过滤宿主专属环境变量，只把允许变量的**名字**放进命令参数；未配置时 `resolveSpawnTarget()` 保留本机执行。`buildFlowEnv()` 默认白名单并移除宿主管理凭据，验收命令复用它。源码见 `orchestrator/src/agent/{runner,cli-runner,docker-exec}.ts`、`orchestrator/src/project/profile-env-builder.ts`、`orchestrator/src/verify/gate.ts`。

`kunpeng acp` 是编辑器接入薄层：`acp/agent.ts` 用 stdio JSON-RPC v1 处理 `initialize/session/new/session/prompt`，提供 `/status`、`/run <绝对路径 spec>`、`/answer`。`/run` 必须读到含 accept 围栏的 Markdown，派流后回 pid/日志；`/answer` 仅对真正的 `RAISE_BLOCKER` 流写反馈、清暂停并从 checkpoint 续跑。stdout 只承载协议消息。源码见 `orchestrator/src/acp/{agent,answer}.ts`。

自建 MCP 服务共用 `mcp/protocol-era.ts`：老客户端走 `initialize` 协商已支持版本，新版请求在 `_meta` 声明版本并要求 `resultType:"complete"`；未知版本返回明确错误，工具列表给 5 分钟缓存提示。此层是协议兼容，不代表每个 MCP 工具可以执行相同业务。源码见 `orchestrator/src/mcp/protocol-era.ts` 与各领域 `mcp-server.ts`。

## 10. 多项目驾驶舱、可观测性与安全

项目注册表把 `projectId → repoPath/name` 对应起来；`server/state-collect` 读取项目快照，`state-snapshot-aggregates.ts` 拼接多项目 flow/plan/loop/门，计数求和，系统灯取最坏项目，保留每条记录的 project 身份。`server/routes` 负责 API 权限与人工门回写，UI 从状态投影渲染。这样同名 flow 或不同项目的人工作业不能只凭当前工作目录混在一起。源码见 `orchestrator/src/project/registry.ts`、`orchestrator/src/server/{state-collect,state-snapshot-aggregates,routes}`。

每条开发流在 `.kunpeng/spans/<flowId>.jsonl` 记录阶段、子 agent 调用和 token；flow 状态用租约、心跳和 CAS 防孤儿/并发覆盖，失败写回归因。成本与质量视图通过 `cost-report`、`escape-rate`、`gate-stats` 等命令消费实际状态与账本。源码见 `orchestrator/src/loop/dev-cycle.ts:314-515`、`orchestrator/src/metrics/span-log.ts、orchestrator/src/runtime/flowstate.ts`、`orchestrator/src/metrics/`、`orchestrator/src/cli-commands/reports.ts`。具体计费仍取决于 backend 上报的 token/价格配置。

1.2.0 的安全边界包括角色能力默认拒绝、member 的敏感入口限制、写 API 同源检查、改密码使旧会话失效、URL 抓取 SSRF 逐跳校验与大小/时间限制、敏感路径自动合并停车，以及 prompt-shield 对下载执行/外传的硬拦。源码入口在 `orchestrator/src/security/`、`orchestrator/src/server/routes/`、`orchestrator/src/runtime/{sensitive-paths,merge-gate}.ts`。这些是多层判定，各自处理不同入口，不能只凭其中一层证明整个系统安全。

## 11. SEO/GEO、代码图与辅助能力

1.2.0 纳入 `skills/seo-audit` 客户诊断流程；仓库当前快照另有 `seo-mcp` 抓取、页面审计、robots、sitemap、canonical、首个 HTML 等内置工具，以及 `[Unreleased]` 新增的 GEO 可引用度、结构化数据、hreflang、AI 爬虫日志、GSC 只读工具。`buildSiteReport()` 目前只把七层规则接入整站总灯；独立 GEO/GSC 工具不会自动进入七层汇总。客户版 GEO 评分还依赖 SERP、外部平台和人工/网页实测数据。代码和规则详见 [SEO 实现说明](2026-10-22-kunpeng-seo-audit-implementation.md) 与 [GEO 实现说明](2026-10-22-kunpeng-geo-audit-implementation.md)。

`codegraph` 通过 `parser.ts` 提取源码符号/import，`cross-file.ts` 建跨文件边，`builder.ts` 组图并由 `store.ts` 保存；`impact.ts` 算受影响节点，`mcp-server.ts` 把图查询交给 agent，`inject.ts` 可把使用说明写进 AGENTS。它是缩小代码阅读范围的辅助索引，不替代编译器、测试和真实调用验证。源码见 `orchestrator/src/codegraph/`。

## 12. 研发阅读顺序与常见误解

建议按一次真实需求追代码：① `cli.ts → cli-commands/devcycle.ts` 看参数；② `plan/spec-lint.ts` 看派流前拒绝条件；③ `plan/orchestrator.ts` 看 phase、并发与集成分支；④ `loop/dev-cycle.ts` 看 worktree、作者验收、实现和验证；⑤ `verify/{gate,scope-gate,eval-asset-guard,evaluator}.ts` 看为什么判过/不过；⑥ `runtime/{flowstate,merge-gate,merge-review}.ts` 看产物状态与合并人工门；⑦ `server/state-collect/` 看结果怎样进驾驶舱。运营任务则从 `cli-commands/ops.ts → loop/{ops-run,driver,ops-gate,ops-guard}.ts` 追。

需要特别区分四组概念：`verified` 与“已合并”；`spec-lint` 静态检查与真实验收执行；差分验证无新增错误与需求已满足；GEO 页面启发式与 AI 实际推荐/引用。研发排查时先看对应产物、flow 状态、验收真实输出和 diff，再看驾驶舱汇总。

**关键函数逐段速查（以一次请求会走到的顺序排列）：**

| 代码段 | 接收什么 | 内部主要判断与副作用 | 返回/落盘 |
|---|---|---|---|
| `cli.ts::main` | argv、环境、当前目录 | 解析 repo/flags；拦 flow 内递归 `run/plan`；刷新 presence；按注册表分发 | CLI 输出与退出码 |
| `plan/spec-lint.ts::lintSpecText` | spec 正文、cwd | 查围栏、scope、accept、点名文件与弱验收，合并重复失败规则 | `SpecLintIssue[]`；派流前遇 error 停 |
| `plan/parse.ts::parseMethodPlan` | Markdown 方案 | 按标题拆 phase 与 flow，构造各段需求 | `PlanModel` |
| `plan/orchestrator.ts::runPlan` | `PlanModel`、仓库、runner | 建集成分支；段内有界并发；段间串行；停信号/预算检查；集成差分门 | plan/flow 产物、集成分支、最终合并门 |
| `git/workspace.ts::Workspace.acquire` | flowId、基线 ref | 建隔离 worktree 和分支，控制单写者；续跑走恢复路径 | flow 工作路径；最终 release/rollback |
| `loop/dev-cycle.ts::DevCycle.runFlow` | 需求、作者验收、依赖 | 固化作者文件、审计、先红、实现、验证、修复、提交；预算/求助可停 | `verified/rolled-back/stopped`、状态和经验 |
| `verify/gate.ts::runVerification` | cwd、命令、超时、环境 | 用白名单环境在 bash 执行；进程错误转非零结果 | `{passed,output,exitCode}` |
| `verify/gate.ts::newFailures` | 基线/改后文本 | 去 ANSI、动态路径/ID、通过行与日志噪声，只取改后新增错误行 | 新失败行数组 |
| `verify/scope-gate.ts::detectScopeDrift` | 改动路径、allow/forbid | forbid 优先；allow 不命中或声明坏即违规 | 逐文件 violation |
| `verify/eval-asset-guard.ts::findEvalAssetViolations` | 改动文件、scope、验收命令 | 查测试/验证资产和验收引用文件，作者及显式 allow 豁免 | 篡改风险列表 |
| `verify/evaluator.ts::parseEvaluatorVerdict` | 只读评估器文本 | 整段 JSON 或对象片段取最后合法三值；无法解析归判不定 | `pass/fail/inconclusive` 与理由 |
| `runtime/merge-gate.ts::mergeAndClearGate` | flowId、主干、人工裁决上下文 | 守门测试、合并锁、停止信号、敏感路径、diff 审查、刷新与合并 | 成功才清门；失败留门和原因 |
| `policy/action-levels.ts::classifyActionLevel` | 动作副作用属性 | 先只读/草稿，再外部可见和不可逆/花钱，最后默认 L2 | L0–L4 等级 |
| `policy/requirements.ts::resolveActionPolicy` | 内建/defaults/spec/requirements | 按层覆盖，再用不可放宽底线钳制 | 每类操作决策、来源及被钳制记录 |
| `server/state-snapshot-aggregates.ts::aggregateReviewQueue` | 多项目快照与 inbox 策略 | 汇门/告警/提案，标 owner、TTL、硬门配额并排序 | 统一待裁决列表 |
| `goals/review.ts::runGoalReview` | 目标、flow、时间窗 | 第一次只提取证据，第二次只提下一期指标；分别校验 JSON | 草稿复盘与待人确认的 target |
| `loop/driver.ts::runLoopWave` | loopId、杠杆、recipe | 波前护栏；L3/L4 批条；解析项目与技能；执行 recipe | 波次结果、台账和缺口 |
| `loop/ops-gate.ts::consumeApprovedOpsGate` | loopId、所需等级 | 找最早、足够等级、带真人裁决、未消费的批准 | 一次性批条或 null |
| `evolution/prediction-check.ts::judgePrediction` | 预测、采纳时间、真实 flow | 等长前后窗、最少各 5 条，算方向化差值 | met/missed/pending/insufficient |
| `skills/skill-safety.ts::scanSkillSafety` | 技能正文 | 正则与注入风险分类；排除近距离否定；硬拦/提示分开 | `{safe,block,warn}` |
| `knowledge/session-harvest.ts::extractCandidates` | 统一会话事件 | 查同工具报错后成功、用户纠正；脱敏并排除安全拒绝 | 待验真候选；入库时 trustTier 0 |
| `acp/agent.ts::createAcpAgent` | JSON-RPC 行消息 | 协商会话，解析 `/run/status/answer`，校验 spec 路径与 accept | 协议响应和状态更新 |
| `mcp/protocol-era.ts::preflightMcp` | 方法、参数 `_meta`、服务身份 | 老式初始化、新版版本校验、服务发现 | 兼容响应或协议错误 |

## 13. 版本边界与本次验证

`CHANGELOG.md` 的 `[1.2.0] - 2026-09-28` 包含决策收件箱、目标对象、L0–L4、agent 求助、ACP、合并加固、span/成本指标、spec-lint 前置、独立评估、自进化预测、技能安全/打包、会话采集、Docker 后端、MCP 双代兼容及 SEO/GEO 审计 skill。当前快照的 `[Unreleased]` 又增加或调整了 SEO/GEO MCP 工具、插件来源、运营/通知加固、模型选项等，本文第 11 节已特别标出。不要把当前目录内容倒推为 2026-09-28 的发布包。

本次通过源码读取与路径核对建立实现说明，没有安装依赖、编译 882 个源文件、跑整套测试或启动服务；因此这里只声明“源码实现与接线形态”，不声明运行环境已通过验证。真实部署还需在有 `.git`、`node_modules` 和项目状态目录的环境里执行 `npm run verify` 及关键入口冒烟。
