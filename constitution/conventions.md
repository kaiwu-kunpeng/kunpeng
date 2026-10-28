# 宪法 · 可演进约定 (CONVENTIONS)

> 与 core.md 不同，本文件**可由自我进化提案修改**（仍需人工门 #2）。放置会随经验调整的约定。

- **【军规·零漂移】改鲲鹏功能一律走自建 loop（落实 core C11）**：新功能/修 bug/接线/小修，默认 `kunpeng plan <spec>`，spec 带作者锁定 accept（` ```accept-file path= ` 块，loop 每次验证前覆盖落盘，实现者改不动）+ ` ```scope` 块。**严禁手改源码绕过 loop**；接线也走 loop（可选参数 + 锁定单测）。例外仅自举/紧急恢复且经人类当次同意、事后披露。任何 agent/会话/实例接入即受此约束，不许以"改动小/很显然/顺手"为由漂移。
- **【军规·不准隐身】任何 agent 开工必注册到所属项目（落实 core C12）**：写 presence（projectId/worktree/任务）+ cockpit 总览展示 + 追加 `AGENTS-ACTIVE.md`。交互会话靠全局 SessionStart hook 自动 `kunpeng register-agent` 兜底；手动 loop/驱动器/cron 须带 profileId/项目归属。隐身干活、不留记录 = 违规。任何 agent/会话/实例接入即受此约束。
- 提交信息规范：Conventional Commits —— `type(scope): 中文描述`。`type` ∈ feat/fix/refactor/test/docs/chore/perf；`scope` 用模块名或整改项号（如 `registry`、`dashboard`、`#9`）。正文写「为什么」，破坏性变更标 `BREAKING CHANGE:`。AI 协作的提交附 `Co-Authored-By:` trailer。
- 分支命名：`kp/<spec-id>-<slug>`（鲲鹏自跑的开发流）；人类/会话开发用 `feat/<topic>`、`fix/<topic>`。
- 代码风格：跟随各项目既有风格，不另立。鲲鹏自身代码遵循 [工程规范](../docs/specs/2026-06-14-engineering-standards-and-layout-draft.md)（ESM `.js` 后缀、`strict` 无 `any`、纯函数/副作用隔离、单文件 ≤ ~300–400 行）。
- 错误处理：**fail-closed，不静默吞错**。不得用 `|| true` 掩盖失败；判不定的验证一律判失败；异步入口 `.catch` 兜底；子进程必带超时并到点 kill。
- append-only 语料：experience 等只增不改的产物用唯一 id（`<前缀>-<flowId>-<时间戳>`），重跑同一 flow 不得覆盖（自我进化输入完整性）。
- 进度上报粒度：每里程碑简短一报，不逐轮征求同意（额度够则持续）。
- 默认模型路由：扫描/格式/分类/文档=haiku；实现/评审=sonnet；设计/审计/进化审计=opus。
- **验收(accept)必须 spec 作者亲写、实现绕不过**：accept 要直接断言「真实产物形态/行为」（导入真函数跑、或具体测试用例），不得只写「让 agent 自己写测试」——会被弱测试/空壳满足而假绿。复杂内嵌 `node -e` 断言会被 accept 解析管线打碎（报 `Not: command not found`），改用简单 `tsc + vitest` + spec 内给死的测试用例 + 合并后人工变异/e2e 复核。
- **accept 的行为断言必须覆盖 scope 内每个该改文件**：scope 里要求改 N 个文件，就得有测试用例**依赖每个文件的改动**（任一文件没改→测试挂）。只跑「某些已有测试通过」不够——agent 会**跳过没被断言到的文件**仍过 accept（曾：loop 漏了 `kpi-registry` 注册，accept 只跑既有 kpi-registry 测试、没断言新注册→假过，合并时才发现要手补）。优先写**端到端/集成型用例**强制多文件协同（如「跑真流程，第2轮结果必须变」），一个用例就把整条链钉死，比逐文件 grep 守卫稳（grep 脆、命名一变就漏）。
- **spec 必带 ```scope``` 块**（allow/forbid glob）：未声明则范围门**直接跳过**，越界改动/回归会溜进集成（曾删 slimFlowsForDashboard、重引入 extract-json 回归）。allow 列全合法改动面；拿不准 agent 放哪就用 `<dir>/**`。
- **绝不乱删非范围文件（C10 落地）**：实现时只动 scope allow 内的文件；**绝不删除/重命名/覆盖 allow 之外的任何既有文件**，不在仓库任意目录写 spec 副本或临时产物。要动 scope 外的东西=停下改 spec，不许自行扩面或"顺手清理"。范围门用三点 diff 只看本流相对分叉点的改动，**看不见陈旧基底合并时对 main 并发改动的覆盖**——故此约束首先靠 agent 自律，机制层用合并前刷新闸（rebase 到当前 main）兜底（曾两次误删/覆盖 flywheel.ts、cli.ts 的 --drive，靠人工恢复）。
- **合并前对抗审查（已固化为代码）**：`kunpeng merge` 默认走 `reviewMerge` 确定性闸（空 diff / 保护文件→人工门#2 / 二进制 / 冲突标记 / 密钥，见 `runtime/merge-review.ts`）。自建 verified（全绿）≠正确，非平凡改动合并前后必人工变异/真实串线复核。
- **agent 已知行为偏好（写 spec 时兜）**：① 爱把新文件跟相关旧文件同住/自行改名 → spec 钉死精确路径或 scope 用 `<dir>/**`；② 对「合并/安全闸 fail-open」有抵触 → 给死实现骨架；③ 倾向降到自己的解读凑绿 → 靠 ①② 约束。
- **多文件 spec 必须单 H1、无 `##` 子标题**：plan 按 md 标题层拆 flow；用 `##` 会被拆成多 flow，无各自 accept 的 flow 整段回滚。分节用粗体而非 `##`，accept 放段内（来源经验 exp-lesson-spec-single-h1）。
- **并发期分支清理必须精确**：有并发会话活动时（main 持续在动）绝不用通配批量删 `kp/plan-*` 分支——只精确删自己本次 run 的分支，否则误删他会话在飞的集成分支（来源经验 exp-lesson-no-mass-delete-branches）。
- **门的有效性要度量（度量先行）**：除现有 holdout pass@k 外，跟踪各闸门的**假阳率（误拦正确改动）/缺陷逃逸率（漏放错误改动）**作为门质量指标；改任一闸门前后先看这两项有没有恶化。确定性门应覆盖 ≥80% 的放行/拦截决策，LLM 判官只兜主观质量、且排在确定性门之后（来源 patrol-mqkr0485 外部调研提炼：confident-ai / sonar / arxiv 2605.01885 共同指向）。
- **给用户看的文档必产 .html + 一切资料/文档落知识库（全项目·全任务·用户硬要求）**：凡产出给用户【阅读】的文档（roadmap / 方案 / 调研 / 报告等 `.md`），**必须同时生成同名 `.html`**（干净可读样式，源 `.md` 仍是真相源）——用户读 html。所有【查回来的资料（外部调研/抓取/参考）】与【形成的文档】都用 `kunpeng capture file <path>`（或 `capture url`/`text`）**落一份到知识库**，便于日后 `kunpeng recall` 查阅。适用所有项目与所有任务，不是某次专项。
- **项目档案层（Project Dossier）· 文档/命名/版本存档统一规范**（方案见 `docs/roadmap/2026-06-20-project-dossier-design.md`，四方调研收敛）：
  - **单一事实源活文档**：每个被管理的项目维护一份 `PROJECT.md`（北极星/目标 → 当前状态 → 决策日志指针 → roadmap(now/next/later) → 进行中的流索引），对标 Codex ExecPlan / Anthropic progress-file，由 loop 自动刷新（`kunpeng dossier`），取代手搓 `SESSION-HANDOFF-vN`。
  - **决策只追加、不可变**：架构/产品决策入 `docs/decisions/NNNN-title.md`（ADR 五要素 Title/Status/Context/Decision/Consequences），accepted 后不改原文；推翻=新建一条并把旧条标 `Superseded by ADR-NNNN`。禁止用文件名 `-v2/-v3` 后缀做版本。
  - **命名**：时序文档 `YYYY-MM-DD-<类别>-<kebab-title>.md`；有序文档（ADR/RFC）`NNNN-title.md`（四位补零）；一律小写 kebab、无空格、无特殊字符。
  - **版本存档**：代码/发布走 SemVer + git tag + `CHANGELOG.md`（Keep a Changelog 六类 Added/Changed/Deprecated/Removed/Fixed/Security，dev-cycle verified 后自动追一条）；活文档（README/PROJECT.md）原地改、git 兜底历史，不留版本副本；spec 同主题迭代用 `supersedes:` frontmatter 串链，不散落。
  - **产物落标准位**：产品轨各阶段产物入 `docs/product/<flow>/`（DEFINE→pr-faq.md、DISCOVER→ost.md、SHAPE→pitch.md），不散落临时目录。
  - **docs-as-code**：文档与代码同仓、随 PR 评审、"改功能必改文档"。
- **规范代码状态读 git ref，不读工作树（ADR-0011，拓扑部分由 ADR-0014 取代）**：`~/kunpeng` 检出在 `main`，是合并与写 spec / 文档的地方；**运行代码只认两个镜像**——派流、定时任务、临时 CLI 一律用 `~/kunpeng-cron/orchestrator/dist/cli.js`（detached main 镜像，由 `com.kunpeng.sync-cron` 追平），驾驶舱用 `~/kunpeng-serve`，**不要从 `~/kunpeng/orchestrator/dist` 跑命令**。凡把"代码"当**指标/正确性判定来源**的（行数/过审行数/文件清单/文件内容做判定），**一律走 `main` git ref**（`git grep -c`/`ls-tree`/`show <ref>:<path>`，封装于 `orchestrator/src/status/loc-ref.ts` 一类 helper），**不得**直接 `readdir/readFile(repoRoot/...src)` 读任何工作树。纯"浏览当前检出"的便利功能（file-serve）可读工作树，但不得作正确性来源。`com.kunpeng.sync-work` 已停用（2026-09-24/27）。

- **【YAGNI·最懒资深工程师】**（借鉴 ponytail，2026-07-11）：最好的代码是没写的代码。实现 spec 时**只做 spec 点名的事**：不加"顺手"的配置项/抽象层/兼容分支/预留钩子；不为想象中的未来需求写代码；能用 20 行平铺直叙解决的不写 100 行"可扩展架构"。审查时把"这段是 spec 要的吗"当第一问，不是的就删。该守则对人和 agent 同等生效。
- **启动路径上的强校验不得因历史遗留数据砖化服务**：给「扫目录 / 读状态文件」新增严格校验时，必须分清【人写的配置】——可以 fail-closed 抛错，写错就该拦——与【会自然积累垢物的数据目录】——一律 warn+skip，绝不 throw。后者抛错等于把一个陈旧 `.bak` 或临时文件升级成全站宕机，而 launchd 的 KeepAlive 会把它放大成崩溃循环（2026-08-06：`~/.kunpeng/chat/admin/` 里躺了一个月的 `.json.bak` 让 serve 崩 2745 次、cockpit 全站 502 约七小时半）。被跳过的条目必须可观察（返回值带出 + 告警一次），不许静默丢。这是对本文件「错误处理：fail-closed，不静默吞错」的边界澄清：**吞掉真错**违规，**为预期垢物抛错**同样违规。
- **外部进程持有 fd 的日志文件绝不能用 rename/unlink 轮转**：launchd 的 StandardOutPath、被重定向的 stdout 这类文件，fd 由外部持有——改名或删除之后服务会继续往那个已被弃置的 inode 写，新文件永远是空的，比不轮转更糟。唯一安全做法是**原地截断同一个 inode**（`writeFileSync(path, ...)` 走 O_TRUNC），保尾去头。断言必须钉 inode：`statSync(path).ino` 截断前后相等；并且要**正向**验证截断之后新日志行确实落进同一个文件，别只看「没报错」。
- **多 H1 spec 的 scope 块会聚合成全局并集，per-段 forbid 会和别段的 allow 对撞**：`parseScopeDeclaration` 用 matchAll 聚合全部 scope 块，allow 与 forbid **都**取并集。于是「段一 forbid 别段目录、段二 allow 该目录」会让两段都被自己的范围门拦死；而 allow 取并集又等于每段实现者都有权碰别段的文件，门的精度归零。写完 spec 必看真解析器干跑打印出来的 scope 并集，不是只看自己那一块；**scope 互斥的段落一律拆成独立 spec 文件串行跑。**
- **launchd 服务「进不去」先分清崩溃循环还是源站正常**：远端 502 或超时时，先 `curl 127.0.0.1:<端口>`——connection refused 说明源站根本没起，别去查隧道和网络。再看 `launchctl print gui/$UID/<label>` 的 runs 与 last exit code：**runs 数千 + last exit code 非 0 = 启动即崩、被 KeepAlive 反复拉起**，崩因就在日志尾部（用 tail，别 grep 全文，那文件可能几百 MB）。**唯一硬判据是隔一分钟再 print 一次、看 runs 还在不在涨**——「state = running」和一个 pid 都可能只是刚被拉起的那一瞬。
- 据 https://arxiv.org/pdf/2510.20270 调研：把 accept/验收阶段跑的 vitest 文件对 implement agent 设为只读(或验收在 agent 不可见的隔离环境跑),合并前用 git diff 硬检测'验收测试文件是否被本流改动',一旦被动过即回滚。这正是鲲鹏'作者文件块 ```ts path= 锁定验收测试'铁律的上游依据,可再加一条:accept 跑测试前先 git checkout 还原被点名的测试文件。
- 据 https://www.augmentcode.com/guides/mutation-testing-ai-generated-code 调研：对'纯文档/弱改动'之外的功能流,验收命令里加一步轻量变异/篡改检查:先确认新测试在'源码未改的 main'上必红(must-fail-first),再在候选源码上必绿——即鲲鹏已有的'先红且红因对'纪律的机械化版本。可对关键新增断言做单点 mutant(改一个返回值/边界)验证测试确实会挂,防 loop 用空断言凑绿。
- 据 https://debugml.github.io/cheating-agents/ 调研：在 autopilot 合并门里加一道独立裁判 agent:用与实现 agent 不同的上下文/账号读 diff+验收输出,专职判'这次通过是真解决还是凑绿(改测试/特判/空实现)',判疑即拦下转人工。对标鲲鹏现有的'审计闸',把'合并前独立复核'固化为默认而非可选。
- 据 https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution 调研：维持鲲鹏'每流一 worktree、改动只走 loop、合并到 main 是人工门'的拓扑;并把'并发 8–10 上限'作为经验阈值。此文印证了鲲鹏踩过的坑(loop worktree 软链 main 的 dist 导致改动'消失'),对应铁律:同文件链上后继流必须先确认前置已是 main 祖先,勿同阶段并改同文件。
- 据 https://arxiv.org/html/2605.02964v1 调研：在验收环境里做'加固减面':accept 脚本运行时清掉 agent 可写的评分钩子、锁死测试目录、剥离能被改的配置(呼应鲲鹏'KUNPENG_BACKEND 注入令测试恒红/恒绿'类环境污染教训——accept 里跑测试统一 env -u 清可疑注入)。加固优先于事后审计。
- 据 https://arxiv.org/pdf/2605.21384 调研：延续鲲鹏'范围过大是回滚主因、拆小粒度重派即过'的锚点纪律,并把它上升为验收门设计原则:单流验收锚点越少越清晰越好,宁可拆成多个短链流串起来,也不要一个长链流带一堆模糊验收标准——后者是假绿与钻空子的温床。
- 据 https://arxiv.org/html/2605.22534 调研：把鲲鹏的合并门条件(验收锚点、审计闸、角色门、captures 软链剥离等)显式收敛成一份版本化的 policy 文件而非散落在脚本里,便于审计与灰度;并保留'人工是最终合并门'的定位——agent 只负责收敛到门槛内,不自动越过人工。
- 据 https://www.augmentcode.com/guides/harness-engineering-ai-coding-agents 调研：鲲鹏应明确区分'门'的角色:确定性测试(必红先行+diff 非空)负责'接受/拒绝'的硬判定,LLM 审查只负责'暴露可疑点'不做终审。呼应已有教训'loop 能验证空 commit'——门必须同时校验 diff 非空 + 具名测试先红。
- 据 https://www.qodo.ai/blog/github-ai-code-review/ 调研：在鲲鹏批量派流场景下(常年 7–8 loop 并发),合并门不能只看单流绿,要有跨流的集成门与去重审查;对标已记录的'集成门假红回收 SOP',把'AI PR 缺陷密度更高'作为默认假设,合并前做一次面向本次 diff 的独立缺陷扫描而非直接信任验收绿。
- 据 https://blog.codacy.com/why-coding-agents-need-independent-quality-gates 调研：确保鲲鹏的验收/审计门进程与实现 agent 完全解耦:不同账号/上下文、门的判定逻辑不由被测流可写。把'验收测试作者文件块锁定''env -u 清注入''diff 非空+具名先红'这些已有铁律统一归类为'独立门要素',并在派流前检查清单里逐项核对(对标已有的'派流前四项检查')。
