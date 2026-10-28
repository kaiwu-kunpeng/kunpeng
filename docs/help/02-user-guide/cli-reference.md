# 鲲鹏 CLI 全命令参考

本文按 CLI 源码的命令模块整理，覆盖命令注册表中的命令。命令体的参数解析、usage 文案和注释是本页的依据；如果本页与运行中的版本不一致，以运行时提示为准。下方索引块由 `kunpeng doc cli-reference` 按命令注册表生成，请勿手改。

<!-- cli-index:start -->
共 103 个命令：`account` · `acp` · `adr` · `ai-repo-kit` · `apply` · `asset-bundle` · `audit` · `auth` · `autopilot` · `backend` · `best-of-n` · `board` · `board-watch` · `bump` · `burn-forecast` · `capture` · `changelog` · `codegraph` · `compile` · `control-plane-audit` · `cost-report` · `deploy` · `design` · `design-codegen` · `design-loop` · `design-memory` · `design-preview` · `distill-skill` · `doc` · `dossier` · `duty` · `escalations` · `escape-rate` · `eval` · `evaluate` · `evolve` · `failures` · `flywheel` · `gate-stats` · `gc` · `goal` · `guard` · `guardian-report` · `inbox` · `inbox-policy` · `install` · `install-hooks` · `kb` · `kickoff` · `lessons` · `lib` · `loop` · `loop-yield` · `loops` · `maintain` · `mcp` · `merge` · `northstar` · `onboard` · `ops` · `ops-pilot` · `ops-report` · `outbox` · `patrol` · `pause` · `plan` · `plugin` · `policy` · `pre-review` · `product` · `projects` · `promote` · `recall` · `register` · `register-agent` · `reinject` · `release` · `resume` · `run` · `savings` · `scope-check` · `scout` · `send` · `seo-mcp` · `serve` · `signal` · `skill` · `snapshot` · `solution` · `spec-delta` · `spec-import` · `spec-index` · `spec-lint` · `status` · `switchboard-mcp` · `task` · `upgrade` · `version` · `web2mcp` · `web2mcp-login` · `weekly` · `worker` · `workspace`
<!-- cli-index:end -->

## 通用调用方式

基本形式为 `kunpeng <命令> [位置参数] [选项]`。

- `--repo <路径>`：指定要操作的目标项目仓库。未指定时依次读取 `KUNPENG_REPO` 和当前目录。下文不再为每个命令重复解释此参数。
- `-h`、`--help`：打印当前版本的公开命令清单。
- `KUNPENG_HOME`：指定鲲鹏宪法、角色卡等自身资源的根目录；它与 `--repo` 指向的目标仓库相互独立。
- 其余选项只在对应命令条目中列出。尖括号表示必填值，方括号表示可选部分；不要把括号本身输入命令行。
- 涉及合并主干、修改治理规则或对外发布的操作仍受人工门约束。

## 知识库（knowledge）

### `capture`

- 用途：把文本、网页或本地文件捕获进项目知识库，也可写入全局知识库。
- 常用参数：`<text|url|file> <value>`、`--project <id>`、`--global`。
- 示例：`kunpeng capture file docs/report.md --project demo --repo <仓库>`

### `kb`

- 用途：聚合已注册项目和全局知识条目，生成目标仓库的 `docs/knowledge-index.md`。
- 常用参数：`--query <查询词>`；不传时生成完整索引。
- 示例：`kunpeng kb --query "缓存" --repo <仓库>`

### `recall`

- 用途：在当前项目的捕获内容中检索资料并打印带来源的命中片段。
- 常用参数：`<query...>`、`--limit N`。
- 示例：`kunpeng recall "缓存 命中率" --limit 10 --repo <仓库>`

### `promote`

- 用途：把指定 capture 提升为已推广知识，并可补充启发式摘要与标签。
- 常用参数：`<captureId>`、`--enrich`。
- 示例：`kunpeng promote cap-example --enrich --repo <仓库>`

## 资料库与技能（library-skills）

### `lib`

- 用途：建立统一资料库索引，检索 spec、文档、捕获内容和技能，并维护条目的有效期与复审状态。
- 常用参数：`scan`、`ls [--type spec|doc|capture|skill] [--status draft|active|archived]`、`search <查询词>`、`verify <id> --days N`、`set <id> [--audience human|agent] [--trigger <说明>] [--status draft|active|archived]`、`review`。
- 示例：`kunpeng lib ls --type spec --status active --repo <仓库>`

### `lessons`

- 用途：列出、蒸馏或整编失败流沉淀的工程教训。
- 常用参数：`list`；`distill [--days N]`；`consolidate [--apply-merges]`。
- 示例：`kunpeng lessons distill --days 7 --repo <仓库>`

### `distill-skill`

- 用途：从经验产物中蒸馏一个技能文件并尝试登记到技能注册表。
- 常用参数：`<name>`、`--desc "<描述>"`。
- 示例：`kunpeng distill-skill release-check --desc "发布检查" --repo <仓库>`

### `skill`

- 用途：查看、校验、搜索和管理已注册技能。
- 常用参数：`list`、`validate [name]`、`search <q> [--category c] [--disabled]`、`enable|disable <id>`、`set <id> ...`、`categorize`、`add|import <目录>`、`remove <id>`。
- 示例：`kunpeng skill list`

## 文档档案（dossier-docs）

### `adr`

- 用途：在 `docs/decisions` 创建自动编号的架构决策记录，并可把旧决策标记为已被取代。
- 常用参数：`"<决策标题>"`、`--status <状态>`（默认 `Proposed`）、`--supersedes <四位编号>`。
- 示例：`kunpeng adr "统一缓存策略" --status accepted --repo <仓库>`

### `bump`

- 用途：提升项目 package 的语义版本，并把 changelog 的 Unreleased 条目滚入新版本区段。
- 常用参数：`major|minor|patch`；优先读取根目录的 `package.json`，不存在时读取 `orchestrator/package.json`。
- 示例：`kunpeng bump patch --repo <仓库>`

### `changelog`

- 用途：把一条变更说明按类型追加到 `CHANGELOG.md` 的 Unreleased 分类中。
- 常用参数：`add "<条目>"`、`--type <类型>`（如 `feat`、`fix`）。
- 示例：`kunpeng changelog add "补齐 CLI 命令索引" --type feat --repo <仓库>`

### `dossier`

- 用途：根据当前流状态刷新项目的活文档 `PROJECT.md`，保留其中的人写区域。
- 常用参数：无命令专属参数。
- 示例：`kunpeng dossier --repo <仓库>`

### `spec-index`

- 用途：扫描 `docs/specs` 下的 Markdown spec 并生成 `docs/spec-index.md`。
- 常用参数：无命令专属参数。
- 示例：`kunpeng spec-index --repo <仓库>`

### `compile`

- 用途：把鲲鹏治理规则编译进目标项目；已有项目自有 `AGENTS.md` 时避免覆盖。
- 常用参数：`--all` 会遍历中央注册表并同步所有已注册项目。
- 示例：`kunpeng compile --repo <仓库>`

### `asset-bundle`

- 用途：把宪法、约定和技能打包成可移植的方法论资产目录。
- 常用参数：`[outDir]`；缺省输出到目标仓库的 `.kunpeng/methodology-bundle`。
- 示例：`kunpeng asset-bundle ./methodology-out --repo <仓库>`

### `doc`

- 用途：把产物库编译成文档索引 `.kunpeng/DOCS.md`。
- 常用参数：无命令专属参数。
- 示例：`kunpeng doc --repo <仓库>`

## spec 工具（spec-tools）

### `spec-import`

- 用途：把 spec-kit 或 OpenSpec 目录转换为新的 Markdown spec，保留 scope 和验收由作者补齐。
- 常用参数：`--from spec-kit|openspec <输入目录> --out <输出.md>`；输出文件已存在时拒绝覆盖。
- 示例：`kunpeng spec-import --from spec-kit ./external-spec --out ./imported-spec.md`

### `codegraph`

- 用途：建立代码图索引、启动代码图服务，或统计指定查询的上下文节省量。
- 常用参数：`index`、`serve`、`savings <查询词>`。
- 示例：`kunpeng codegraph index --repo <仓库>`

### `spec-lint`

- 用途：检查 spec 的结构与约束问题，并在严格模式下把警告也视为失败。
- 常用参数：`<spec.md>`、`--strict`。
- 示例：`kunpeng spec-lint docs/specs/example.md --strict --repo <仓库>`

### `ai-repo-kit`

- 用途：按项目名在指定目录生成 AI 友好的仓库骨架套件。
- 常用参数：`<projectName> <outDir>`。
- 示例：`kunpeng ai-repo-kit demo ./demo-kit`

### `spec-delta`

- 用途：比较两份 spec，输出基线版本与下一版本之间的差异判定。
- 常用参数：`<base.md> <next.md>`。
- 示例：`kunpeng spec-delta specs/base.md specs/next.md`

### `release`

- 用途：执行构建命令并把结果记录为待人工确认的 release 产物。
- 常用参数：`"<build command>"`；成功返回 0，失败返回 2。
- 示例：`kunpeng release "npm run build" --repo <仓库>`

## 报表度量（reports）

### `control-plane-audit`

- 用途：读取中央控制面审计账本，列出文件变更的时间、仓库路径和前后哈希。
- 常用参数：`--limit N`，默认显示最近 100 条，N 必须为正整数。
- 示例：`kunpeng control-plane-audit --limit 20`

### `gate-stats`

- 用途：汇总门账本中的人工与机器清门频率、人工耗时中位数和当前未清门数量。
- 常用参数：`--days N`（默认 21 天，须为正数）、`--all-projects`。
- 示例：`kunpeng gate-stats --days 21 --repo <仓库>`

### `northstar`

- 用途：按周统计无人介入且满 14 天未 revert 的合入数，并列出人工介入、绕门合入、revert 与敏感合入护栏。
- 常用参数：`--weeks N`（默认 8 周，须为正整数）、`--all-projects`。
- 示例：`kunpeng northstar --weeks 8 --repo <仓库>`

### `burn-forecast`

- 用途：根据已花费用、预算和已用小时计算预算燃尽预测。
- 常用参数：`<spentUsd> <budgetUsd> <elapsedHours>`。
- 示例：`kunpeng burn-forecast 12.5 100 8`

### `cost-report`

- 用途：汇总开发流的月度 token 与估算费用，并显示缓存命中率。
- 常用参数：`--month YYYY-MM`、`--json`。
- 示例：`kunpeng cost-report --month 2026-07 --json --repo <仓库>`

### `weekly`

- 用途：汇总最近若干天的流状态，打印并写入 Markdown 周报。
- 常用参数：`--days N`，默认 7 天。
- 示例：`kunpeng weekly --days 7 --repo <仓库>`

### `failures`

- 用途：聚类最近若干天的失败流并列出最常见失败模式。
- 常用参数：`--days N`，默认 7 天。
- 示例：`kunpeng failures --days 14 --repo <仓库>`

### `status`

- 用途：采集并打印目标项目各模块的当前运行状态。
- 常用参数：无命令专属参数。
- 示例：`kunpeng status --repo <仓库>`

### `savings`

- 用途：估算 verified 开发流相对人工基准节省的净工程工时。
- 常用参数：`--all-projects` 可跨中央注册表中的全部项目汇总。
- 示例：`kunpeng savings --all-projects`

### `escape-rate`

- 用途：依据合并、revert 和 rolled-back 状态计算缺陷逃逸率。
- 常用参数：`--window <天数>`、`--all-projects`。
- 示例：`kunpeng escape-rate --window 30 --repo <仓库>`

## 通讯（switchboard）

### `escalations`

- 用途：结合在线实例和消息记录，列出无人接收或超时、需要升级处理的紧急消息。
- 常用参数：无命令专属参数。
- 示例：`kunpeng escalations`

### `kickoff`

- 用途：向全部 switchboard 实例广播本次开工涉及的文件范围与任务说明。
- 常用参数：`<文件...> --what "<做什么>"`、`--from <实例>`。
- 示例：`kunpeng kickoff docs/help/02-user-guide/cli-reference.md --what "补齐命令参考" --from docs-agent`

### `register-agent`

- 用途：根据当前工作目录登记 agent 的项目归属、presence 和任务，并留下活动记录。
- 常用参数：`--instance <实例>`、`--task "<任务>"`、`--pid <正整数>`；实例未指定时读取 `KUNPENG_INSTANCE`，再回退到 `main`。
- 示例：`kunpeng register-agent --instance docs-agent --task "补齐命令参考"`

### `send`

- 用途：把普通或紧急消息写入指定实例的 switchboard 收件队列，并更新发送方 presence。
- 常用参数：`<收件人> <正文...>` 或 `--to <收件人> --body <正文>`；支持 `--topic <主题>`、`--type <消息类型>`、`--from <实例>`、`--urgent`，使用 `--body` 时应把正文放在最后。
- 示例：`kunpeng send reviewer "请检查命令参考" --from docs-agent --topic cli-reference`

### `signal`

- 用途：向指定实例写入停止信号，使接收方在下一检查点优雅停止。
- 常用参数：`--to <实例>`、`--from <实例>`、`[停止原因...]`；未写原因时正文为“停止请求”。
- 示例：`kunpeng signal --to docs-agent --from main "暂停当前任务"`

### `switchboard-mcp`

- 用途：通过标准输入输出启动 switchboard 的 MCP 服务，供工具客户端接入消息与协作能力。
- 常用参数：无命令专属参数。
- 示例：`kunpeng switchboard-mcp`

### `inbox`

- 用途：读取当前实例的 switchboard 收件箱，并显示在线实例。
- 常用参数：`--as <实例>`、`--unread`、`--peek`、`--watch`、`--interval <秒>`。
- 示例：`kunpeng inbox --as reviewer --unread`

### `outbox`

- 用途：列出待外发队列，或把 IndexNow 通道中的待发记录刷新出去。
- 常用参数：无子命令时只列出；外发语法为 `flush indexnow`，且要求 `INDEXNOW_KEY`。
- 示例：`kunpeng outbox --repo <仓库>`

## 项目管理（project-admin）

### `auth`

- 用途：初始化或修改总控台本地用户密码，并可添加带角色和 profile 归属的登录账号。
- 常用参数：`set-password [--user <名>]`、`add-user <名> [--role owner|member] [--profile <id>]`；密码从 `KUNPENG_AUTH_PASSWORD` 或标准输入读取。
- 示例：`kunpeng auth set-password --user admin`

### `version`

- 用途：打印当前生效的鲲鹏 orchestrator、Node.js 与操作系统平台版本；同名的“提升 package 语义版本”命令已被后注册的本命令覆盖。
- 常用参数：无命令专属参数。
- 示例：`kunpeng version`

### `upgrade`

- 用途：读取升级通道并比较版本，也可下载升级包；`--apply` 当前只打印手动升级指引，不会自动安装。
- 常用参数：`--download`、`--apply`；升级通道来自 `KUNPENG_UPDATE_URL` 或 `~/.kunpeng/update-channel.json` 的 `manifestUrl`。
- 示例：`kunpeng upgrade --download`

### `workspace`

- 用途：为流申请、释放或放弃隔离 worktree。
- 常用参数：`<acquire|release|abandon> <id> [base]`。
- 示例：`kunpeng workspace acquire demo-flow main --repo <仓库>`

### `register`

- 用途：把目标仓库写入中央项目注册表，并在仓库内写项目自描述。
- 常用参数：`--name <展示名>`。
- 示例：`kunpeng register --repo <仓库> --name "示例项目"`

### `projects`

- 用途：列出中央注册表中的全部项目 ID、名称与仓库路径。
- 常用参数：无命令专属参数。
- 示例：`kunpeng projects`

### `gc`

- 用途：清理相对指定基线已经合并的流分支和过期日志。
- 常用参数：`[base]`、`--dry-run`；建议先 dry-run 查看精确目标。
- 示例：`kunpeng gc main --dry-run --repo <仓库>`

### `onboard`

- 用途：为已注册项目渲染接管声明，并附上已有的研究建议。
- 常用参数：无命令专属参数；目标项目必须已注册。
- 示例：`kunpeng onboard --repo <仓库>`

### `backend`

- 用途：查看当前执行后端，或把偏好切换为本地或 Codex Cloud。
- 常用参数：`[local|codex-cloud]`；不传时只显示当前配置。
- 示例：`kunpeng backend local`

### `snapshot`

- 用途：保存中央运行状态快照，并只保留最近 7 份。
- 常用参数：无命令专属参数。
- 示例：`kunpeng snapshot`

## 账号（accounts）

### `account`

- 用途：登记、列出和移除 Claude 或 Codex 账号，并检查凭证目录中的登录态。
- 常用参数：`list`、`add <名> --backend <claude|codex> [--cred-dir <目录>] [--limit N] [--window <小时>]`、`remove <名>`、`doctor`。
- 示例：`kunpeng account add work --backend codex --cred-dir <凭证目录>`

## MCP（mcp）

### `mcp`

- 用途：登记、查看、启停、移除 MCP server，并同步共享 MCP 基础配置。
- 常用参数：`list`、`add <id> (--url <url> | --command <bin>) [--arg <v> ...] [--name <名>] [--env K=V ...] [--header K=V ...] [--disabled]`、`remove|enable|disable <id>`、`sync [--refresh]`。
- 示例：`kunpeng mcp add docs --command local-docs-server --arg ./docs`

## 插件（plugin）

### `plugin`

- 用途：登记和管理本地插件；登记与启用默认分离，启用后会自动登记插件技能和 MCP 条目。
- 常用参数：`validate <目录> [--strict]`（校验 skills / agents / hooks / mcp / workflows 五类贡献；默认软问题只警告，`--strict` 将警告视为错误）、`add <本地目录|.kpkg|git url --commit <40 位 sha>> [--enable]`（git 来源 clone 到插件根 `cache/` 并 checkout 到钉死的 commit，不带 `--commit` 拒绝）、`list`、`upgrade <name> [<目录|.kpkg|git url> --commit <sha>]`（不给来源则按 `marketplace.json` 该插件的登记来源；候选版本必须高于已装版本，同名校验、minKunpengVersion 校验；原来启用的升级后自动重新启用并换注册技能/MCP；旧版记入 `previous` 可回退）、`rollback <name>`（换回 `previous` 记录的上一版本，被换下的版本再记成 `previous`，可来回；上一版本目录丢失则拒绝）、`enable|disable|remove <name>`、`market`（只读列出插件根目录的 `marketplace.json` 清单；来源支持 `local` 目录、`kpkg` 包与 `git` 仓库，`kpkg` 必须用 64 位十六进制 `sha256` 钉版，`git` 必须给 `url`（https/ssh/git@/file）与 40 位 `commit` 钉版；`distribution` 为 `off` 下架 / `on` 可用〔缺省〕/ `required` 必装且启用，可选 `pin` 钉 semver 版本）、`doctor`（只读对账六类问题：required 缺装、required 未启用、off 仍装、pin 版本漂移、kpkg sha256 不符或不可读、git 已装目录 HEAD 与市场钉的 commit 不符或不可读、已登记目录丢失或不在非空清单的野装；有错误时退出码 1，只有警告时不置失败；清单缺失或无条目视为空市场，不报野装）。
- 示例：`kunpeng plugin add ./plugins/release-tools --enable`

## 产品（product）

### `product`

- 用途：把一句话产品想法推进为产品定义，也可继续执行发现、塑形、验证和方案聚合阶段。
- 常用参数：`"<一句话产品想法>"`；或 `discover`、`shape`、`validate [--hypothesis <假设>]`、`plan`。
- 示例：`kunpeng product "为独立开发者生成可靠的发布清单" --repo <仓库>`

## 设计（design）

### `design`

- 用途：根据一句话需求运行确定性设计建议管线，输出风格、配色、字体及反模式检查结果。
- 常用参数：`"<一句话设计需求>"`、`--persist`（保存 MASTER）、`--page <名>`（指定保存目录名）。
- 示例：`kunpeng design "简洁的知识库首页" --persist --page knowledge --repo <仓库>`

### `design-loop`

- 用途：检查设计 BRIEF，结合风格记忆生成设计 token 与提示词，并可调用生成器产出页面或幻灯片。
- 常用参数：`"<一句话>"` 或 `--brief <brief.json>`；支持 `--preset <id>`、`--seed <hex>`、`--anchors a,b,c`、`--brand-domain <域名>`、`--brand <brand.json>`、`--out <目录>`；生成支持 `--generate`、`--rounds N`、`--deck`、`--slides N`。
- 示例：`kunpeng design-loop --brief ./brief.json --seed "#2563eb" --out ./design-out --repo <仓库>`

### `design-memory`

- 用途：读取设计决策记忆，按项目类型桶和风格锚输出胜出次数与胜率。
- 常用参数：无命令专属参数；记录来自 `design-loop --generate` 的设计结果。
- 示例：`kunpeng design-memory --repo <仓库>`

### `design-preview`

- 用途：从候选设计来源生成并渲染预览，供总控台比较和选择。
- 常用参数：`--sources <逗号分隔来源>`；可把其余位置参数作为方案上下文。
- 示例：`kunpeng design-preview "项目首页" --sources house --repo <仓库>`

### `design-codegen`

- 用途：把项目中已选定的设计契约生成为 token、安装说明和 starter 等前端产物。
- 常用参数：可提供位置参数作为非 House 设计来源的方案上下文；未选设计时会提示先运行预览。
- 示例：`kunpeng design-codegen --repo <仓库>`

## 看板与服务（board-serve）

### `board`

- 用途：把项目进度写成工具无关的 `.kunpeng/BOARD.md` 与 `board.json`。
- 常用参数：无命令专属参数。
- 示例：`kunpeng board --repo <仓库>`

### `task`

- 用途：创建、领取、完成、查看或回收任务板中的任务。
- 常用参数：`create|claim|claim-next|complete|list|show|reap`；创建支持 `--desc`、`--created-by`、`--blocked-by`、`--project`，回收支持 `--stale-min N`。
- 示例：`kunpeng task create "补齐发布测试" --desc "覆盖失败路径" --repo <仓库>`

### `board-watch`

- 用途：把另一个项目加入跨工具看板聚合列表，或查看当前 watch 列表。
- 常用参数：`<项目路径>`、`--list`。
- 示例：`kunpeng board-watch --list`

### `serve`

- 用途：启动常驻的 HTTP 总控台；可运行单项目或中央注册表聚合模式。
- 常用参数：`[port]`，默认 7777；`--host <地址>`；传 `--repo` 时为单项目模式。
- 示例：`kunpeng serve 7777 --host 127.0.0.1 --repo <仓库>`

### `pre-review`

- 用途：对所有 draft 提案执行机器预审并把裁定写回产物元数据。
- 常用参数：无命令专属参数。
- 示例：`kunpeng pre-review --repo <仓库>`

### `web2mcp`

- 用途：发现网页中的 form 或 network 动作，并生成独立 MCP server 工程。
- 常用参数：`<url>`、`--out <dir>`、`--auth <storageState.json>`、`--discover form|network|both`、`--max-actions N`。
- 示例：`kunpeng web2mcp https://example.com --discover form --out ./web2mcp-out`

### `web2mcp-login`

- 用途：打开可视浏览器供用户手动登录，并把会话保存成 storage state。
- 常用参数：`<url>`、`--out <storageState.json>`。
- 示例：`kunpeng web2mcp-login https://example.com --out auth.json`

### `scout`

- 用途：研究项目所在领域并把建议写入 `.kunpeng/suggestions.md`，也可管理每日调度。
- 常用参数：`--topic <主题>`、`--install`、`--uninstall`、`--interval <秒>`。
- 示例：`kunpeng scout --topic "开发者工具可观测性" --repo <仓库>`

## 运营（ops）

### `ops-pilot`

- 用途：为指定运营 loop 规划下一杠杆、技能、波目标与止损条件，默认写回 nextLever。
- 常用参数：`<loopId>`、`--dry`（仅规划，不写回）。
- 示例：`kunpeng ops-pilot growth --dry --repo <仓库>`

### `ops-report`

- 用途：结合指定运营 loop 最新的执行动作和对应波计划，打印最近一波的执行报告。
- 常用参数：`<loopId>`。
- 示例：`kunpeng ops-report growth --repo <仓库>`

### `loops`

- 用途：列出目标项目的运营 loop，每行首列是该 loop 的 projectId（多租户串仓一眼可见），随后是当前指标、波次数和下一杠杆；无 loop 时打印 `(无 loop)`。
- 常用参数：无命令专属参数。
- 示例：`kunpeng loops --repo <仓库>`

### `solution`

- 用途：列出、保存或实例化可复用的运营方案模板。
- 常用参数：`list`；`save <id> --name <名称> --playbooks <ids> [--configs <路径>]`；`apply <id> --project <projectId> [--name <名称>] [--run]`。
- 示例：`kunpeng solution list`

### `ops`

- 用途：把到期 playbook 分流为自动 loop 或人工 review 门，也可管理系统调度。
- 常用参数：`--install`、`--uninstall`、`--print-cron`、`--interval <秒>`；`--no-duty` 本轮不跑值班员（缺省每轮末尾跑一次 `duty tick`）。
- 示例：`kunpeng ops --print-cron --repo <仓库>`

## 飞轮评测（flywheel-eval）

### `best-of-n`

- 用途：让同一份单流 spec 并行产生 N 个候选实现，并按真实验收结果选优。
- 常用参数：`<spec.md>`、`--n <N>`；N 至少为 2。
- 示例：`kunpeng best-of-n specs/change.md --n 3 --repo <仓库>`

### `reinject`

- 用途：把守护发现去重写入反馈 backlog，或查看并驱动 backlog。
- 常用参数：`--list`、`--drive`、`--max N`、`--accept "<验收命令>"`、`--adaptive`。
- 示例：`kunpeng reinject --list --repo <仓库>`

### `flywheel`

- 用途：执行“守护扫描入队—活锁检查—backlog 驱动”的飞轮一轮，或管理定时自转。
- 常用参数：`--max N`、`--no-scan`、`--adaptive`、`--install`、`--uninstall`、`--print-cron`、`--interval <秒>`、`--mixed`。
- 示例：`kunpeng flywheel --no-scan --max 1 --repo <仓库>`

### `evolve`

- 用途：消费 experience 产物并生成只停留在 draft 状态的自我进化提案。
- 常用参数：无命令专属参数；提案不会自动修改 core 或 conventions。
- 示例：`kunpeng evolve --repo <仓库>`

### `evaluate`

- 用途：为指定进化提案附加 holdout 可靠性证据，可选择基线与候选规则差分评测。
- 常用参数：`<proposalId>`、`--differential`、`--limit N`；差分模式还支持 `--strip <file>`。
- 示例：`kunpeng evaluate proposal-123 --differential --limit 2 --repo <仓库>`

## 维护守护（maintain-guardian）

### `guardian-report`

- 用途：实际协调死流、陈旧产物、幽灵合并门和孤儿 worktree，并输出本次清理报告。
- 常用参数：无命令专属参数；运行会执行协调清理。
- 示例：`kunpeng guardian-report --repo <仓库>`

### `maintain`

- 用途：运行维护扫描、沉淀提案和知识，并处理已批准提案；也可登记人工维护时间。
- 常用参数：`log "<what>" <minutes>`、`--research`、`--install`、`--uninstall`、`--interval <秒>`。
- 示例：`kunpeng maintain --repo <仓库>`

### `apply`

- 用途：执行已经通过相应批准状态的自我进化提案落地流程。
- 常用参数：无命令专属参数；未获批准的提案不会由此命令直接应用。
- 示例：`kunpeng apply --repo <仓库>`

## 研发周期（devcycle）

### `install-hooks`

- 用途：把提示词防护模块 `prompt-shield.mjs` 写入指定的钩子目录。
- 常用参数：`--dest <目录>`，默认写入 `~/.kunpeng/hooks`。
- 示例：`kunpeng install-hooks --dest ./hooks`

### `run`

- 用途：受理一句需求并运行完整开发周期，验证通过后留下待合并的流分支。
- 常用参数：`"<需求>"`、`--accept "<精确验收命令>"`、`--adaptive`。
- 示例：`kunpeng run "补齐登录失败测试" --accept "npm test" --repo <仓库>`

### `pause`

- 用途：为运行中的流写入暂停请求，使它在下一个阶段边界保存 checkpoint 后停下。
- 常用参数：`<flowId>`。
- 示例：`kunpeng pause flow-example --repo <仓库>`

### `resume`

- 用途：清除暂停标记并从已有 checkpoint 续跑指定流，同时回灌已有人工审查意见。
- 常用参数：`<flowId>`。
- 示例：`kunpeng resume flow-example --repo <仓库>`

### `guard`

- 用途：运行目标项目可检测到的 typecheck、lint 与 TODO 扫描，并写入 review 产物。
- 常用参数：无命令专属参数。
- 示例：`kunpeng guard --repo <仓库>`

### `audit`

- 用途：执行 npm 漏洞审计，并可在隔离 worktree 中尝试非破坏性自动修复与验证。
- 常用参数：`--fix`；不传时只输出漏洞与修复计划。
- 示例：`kunpeng audit --repo <仓库>`

### `merge`

- 用途：经停止信号、对抗审查、钩子和刷新闸后，把 `kp/<flowId>` 安全合并到基线并清门。
- 常用参数：`<flowId> [base]`，base 默认 `main`；这是合并主干人工门对应的执行命令。
- 示例：`kunpeng merge flow-example main --repo <仓库>`

### `scope-check`

- 用途：读取 spec 的 `scope` 声明，检查指定流分支的改动文件是否越界。
- 常用参数：`<spec.md> <flowId>`。
- 示例：`kunpeng scope-check specs/change.md flow-example --repo <仓库>`

## 核心驱动（loop-core）

### `loop`

- 用途：注册运营 loop、记录波次、设置下一杠杆、执行一波或连续自动推进。
- 常用参数：子命令为 `register|record|set-next|run|autopilot`，各字段使用 `--id`、`--name`、`--project`、`--recipe`、`--lever` 等具名参数；详见 `kunpeng loop` 运行时提示。
- 示例：`kunpeng loop run --id growth --repo <仓库>`

### `autopilot`

- 用途：扫描一个或多个项目的合并门，自动处理可安全合并、确定无效和需跳过的流。
- 常用参数：传 `--repo` 时仅处理单仓库。进化提案一律由人批准（人工门 #2），autopilot 不代批。
- 示例：`kunpeng autopilot --repo <仓库>`

### `plan`

- 用途：解析 Markdown 方案，补齐并审计验收命令，再按阶段和并发上限驱动所有 flow。
- 常用参数：`<方案.md>`、`--concurrency N`。
- 示例：`kunpeng plan specs/method-plan.md --concurrency 3 --repo <仓库>`

### `patrol`

- 用途：运行一轮自进化巡检与沉淀，或安装、卸载和打印定时巡检配置。
- 常用参数：`--research [话题...]`、`--all-projects`、`--install`、`--uninstall`、`--print-cron`、`--interval <秒>`。
- 示例：`kunpeng patrol --all-projects --repo <仓库>`

## Agent 通信协议（acp）

### `acp`

- 用途：通过标准输入输出提供 ACP agent 服务，支持查询流、派发任务和答复阻塞问题。
- 常用参数：无命令专属参数；标准输出用于 ACP 协议消息。
- 示例：`kunpeng acp`

## 部署管理（deploy）

### `deploy`

- 用途：查看线上与 main 的部署差异及公开路由变化，并管理部署暂停闸或检查放行条件。
- 常用参数：`status|hold|release|check`、`--desc "<原因>"`；`check` 通过返回 0，拦截返回 1。
- 示例：`kunpeng deploy status`

### `install`

- 用途：生成 macOS launchd 或 Linux systemd 服务配置文件，并打印手动加载指引。
- 常用参数：`--service`（必填）、`--port <1-65535>`（默认 7788）、`--serve-dir <目录>`、`--cron-dir <目录>`、`--tunnel <名称>`、`--out <目录>`。
- 示例：`kunpeng install --service --port 7788 --out ./service-units --repo <仓库>`

## 回归评测（eval）

### `eval`

- 用途：从已验证 spec 采集黄金任务，重放其验收命令并生成或查看回归报告。
- 常用参数：`harvest <flowId>`、`run [--sample N]`（N 为非负整数）、`report`（查看最新报告）。
- 示例：`kunpeng eval run --sample 5 --repo <仓库>`

## 目标管理（goals）

### `goal`

- 用途：登记与跟踪产品目标、指标和预算，并生成复盘草稿供人工采纳或驳回目标调整。
- 常用参数：`add <product> <目标描述...> [--id <id>] [--owner <负责人>] [--budget-usd N] [--due YYYY-MM-DD] [--metric key:label:target:up|down]`、`list [--json]`、`done|pause <id>`、`set-current <id> <数值>`、`review <goalId> [--days N]`、`accept <reviewId>`、`reject <reviewId> [说明...]`、`reviews [goalId]`。
- 示例：`kunpeng goal list --json --repo <仓库>`

## 收件箱策略（inbox-policy）

### `inbox-policy`

- 用途：查看或保存中央收件箱的离席期限、每项目每日硬门上限和门的有效时长。
- 常用参数：`show`、`absence <小时> [--note <文字>]`、`present`、`cap <正整数>`、`ttl <小时>`；小时数须为正数。
- 示例：`kunpeng inbox-policy show`

## 动作策略（policy-cmd）

### `policy`

- 用途：查看本仓生效的动作策略——操作类别（shell / file / network / publish）× 三态（deny / ask / allow）、每项来源、被 requirements 底线压回的覆盖；只读，不改文件。
- 常用参数：`show`；`--repo <path>` 指定仓库；`--json` 输出机器可读结构。
- 示例：`kunpeng policy show --repo . --json`

## 值班员（duty）

### `duty`

- 用途：值班员跑一轮——从运营应跑账本、流状态、outbox 派生事件，按处置手册（首批六条，L0–L2）执行停 / 降 / 重试 / 通知 / 起草白名单动作，无匹配或越级一律转人并落台账 `ops/runbook-runs.jsonl`。
- 常用参数：`tick`；`--repo <path>` 指定仓库；`--dry` 只决策不执行、不落账。
- 示例：`kunpeng duty tick --repo . --dry`

## 循环产出（loop-yield-cmd）

### `loop-yield`

- 用途：按循环与项目汇总台账中的最近投入、产出和累计轮数，并在检测到告警时返回失败状态。
- 常用参数：无命令专属参数。
- 示例：`kunpeng loop-yield --repo <仓库>`

## 搜索优化（seo）

### `seo-mcp`

- 用途：启动 SEO MCP 服务，或抓取指定站点并输出分层检查报告及 JSON 数据。
- 常用参数：`serve`、`report <http(s)://站点> [--out <目录>] [--max-pages N]`。
- 示例：`kunpeng seo-mcp report https://example.com --max-pages 10 --out ./seo-report --repo <仓库>`

## 工作机（worker）

### `worker`

- 用途：把本机作为工作机连接到 cockpit 的 WebSocket 服务，并报告连接状态。
- 常用参数：`--url <ws(s)://地址>`、`--name <名称>`、`--root <目录>`、`--config <JSON文件>`、`--token <token>`、`--insecure`；token 推荐通过 `KUNPENG_WORKER_TOKEN` 或配置文件提供。
- 示例：`kunpeng worker --url wss://cockpit.example.com/api/worker/connect --name worker-a --root ./workspace`

## 未列入 usage 的内部命令

以下 22 个名称未出现在 `usageText()` 的公开清单中，只作为内部接线、进阶工作流或来源标识列出；使用前应先核对当前源码与治理边界。

- `adr`：内部/进阶，用于建立 ADR 决策记录，并可声明状态或取代旧 ADR。
- `auth`：内部/进阶，用于为总控台设置本地登录用户名和密码配置。
- `changelog`：内部/进阶，用于向 `CHANGELOG.md` 的 Unreleased 分类追加条目。
- `claude-native`：内部/进阶，设计候选池中的 Claude 原生设计来源标识。
- `design`：内部/进阶，根据一句话需求运行确定性设计建议管线并可持久化 MASTER。
- `design-loop`：内部/进阶，执行从 BRIEF 门、token 生成到可选页面生成的完整设计循环。
- `design-memory`：内部/进阶，查看设计循环按项目桶和风格锚累计的胜率记忆。
- `escalations`：内部/进阶，检查无人接收或超时的紧急 switchboard 消息。
- `figma`：内部/进阶，设计候选池中的 Figma 工具来源标识。
- `guardian-report`：内部/进阶，协调死流、陈旧产物、幽灵门和孤儿 worktree 并打印报告。
- `kickoff`：内部/进阶，向所有实例广播包含文件范围和任务说明的开工消息。
- `lib`：内部/进阶，扫描、搜索、校验和维护统一资料库索引。
- `lint`：内部/进阶，守护和飞轮按项目探测后使用的 lint 扫描器名称。
- `ops-pilot`：内部/进阶，为指定运营 loop 规划或写回下一杠杆。
- `ops-report`：内部/进阶，为指定运营 loop 的最近波次生成执行报告。
- `register-agent`：内部/进阶，把当前 agent 的实例、工作目录和任务登记到项目 presence。
- `send`：内部/进阶，向指定 switchboard 实例发送普通或紧急消息。
- `signal`：内部/进阶，向指定实例发送在下一检查点优雅停止的信号。
- `stitch`：内部/进阶，设计候选池中的 Google Stitch 来源标识。
- `switchboard-mcp`：内部/进阶，以 stdio 方式启动 switchboard MCP 服务。
- `typecheck`：内部/进阶，守护和飞轮按项目探测后使用的类型检查扫描器名称。
- `version`：内部/进阶，提升 package 语义版本并滚动 changelog 的 Unreleased 区段。
