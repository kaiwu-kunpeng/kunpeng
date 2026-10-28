# 鲲鹏环境变量参考

本表以如下命令的输出为唯一真源，并排除测试文件：

```bash
grep -rohE 'KUNPENG_[A-Z0-9_]+' orchestrator/src --include='*.ts' --exclude='*.test.ts' | sort -u
```

“默认值”描述变量未设置、为空或无效时当前源码采用的行为。布尔开关通常只在值严格等于 `1` 时启用。路径应使用绝对路径，systemd 的 `EnvironmentFile` 不会执行 shell 展开。

| 变量 | 说明 | 默认值 |
|---|---|---|
| `KUNPENG_ACCOUNTS` | 覆盖账号池 `accounts.json` 的路径。 | `<KUNPENG_HOME>/.kunpeng/accounts.json` |
| `KUNPENG_ALLOW_INSECURE` | 值为 `1` 时，允许无 cockpit 密码却监听非回环地址。 | 关闭；非回环且无密码时拒绝启动 |
| `KUNPENG_AUTH_PASSWORD` | 为 `kunpeng auth set-password` 临时提供密码，避免放入命令行参数。 | 未设置；非 TTY 时从 stdin 读取 |
| `KUNPENG_AUTHZ_POLICY` | `restricted`（默认）启用逐路由能力表：member 只保留浏览、对话、派流，未登记路由一律拒绝；`open` 回旧行为（member 与 owner 能力相同，仅账号管理需 owner）。 | `restricted` |
| `KUNPENG_AUTO_MERGE` | 值为 `1` 时，verified 后立即尝试通过合并闸。 | 关闭 |
| `KUNPENG_BACKEND` | 强制使用 `codex` 或 `claude` agent 后端。 | 未设置；按内置 stage 路由选择 |
| `KUNPENG_BACKEND_DOWN_TTL_MS` | 后端/模型下线标记的有效期毫秒数，写在 `.kunpeng/backend-health.json`。 | `1800000`（30 分钟） |
| `KUNPENG_CAPTURER` | 选择设计截图器：`playwright`、`agent` 或 `fake`。 | `playwright` |
| `KUNPENG_CAPTURES_ROOT` | 覆盖知识捕获的根目录。 | `<KUNPENG_STATE>/captures` |
| `KUNPENG_CHAT_COMPACT_HINT` | cockpit 对话达到该输入 token 数后提示 `/compact`。 | `140000` |
| `KUNPENG_CHAT_SESSION_USD_BUDGET` | 单个 cockpit 会话的美元预算上限；达到后阻止继续运行。 | 未设置，不限额 |
| `KUNPENG_CODEX_STRICT_MCP` | 值为 `1` 且存在 MCP 配置时，让 Codex 忽略用户级配置。 | 关闭 |
| `KUNPENG_CODEX_UNSANDBOXED` | 已废除（安全5）：设置无效，只打印一次警告；codex 一律跑在 `workspace-write` 沙箱。 | 无效 |
| `KUNPENG_CODEX_NETWORK` | 值为 `1` 时允许 Codex 在 workspace-write 沙箱内联网（tools 含 WebSearch/WebFetch 时自动打开）。 | 关闭 |
| `KUNPENG_CODEX_WRITABLE_ROOTS` | 额外可写目录，绝对路径，`:` 分隔，逐个转成 `--add-dir`；相对路径忽略。 | 空 |
| `KUNPENG_DOCS_DIR` | 指定 cockpit 文档视图读取的策略文档目录。 | `~/kunpeng-strategy-docs` |
| `KUNPENG_EXECUTION_BACKEND` | 选择任务执行位置：`local` 或 `codex-cloud`。 | `local`，持久化偏好存在时使用该偏好 |
| `KUNPENG_FLOW_LOG` | 指定当前 flow 的日志文件路径，cockpit 启动任务时会注入。 | 自动生成于 `<repo>/.kunpeng/cockpit/logs/` |
| `KUNPENG_FLOW_MS_BUDGET` | 单 flow 的墙钟预算，单位为毫秒。 | 未设置，不限额 |
| `KUNPENG_FLOW_TOKEN_BUDGET` | 单 flow 的 token 预算。 | 未设置，不限额 |
| `KUNPENG_FLOW_USD_BUDGET` | 单流阶段混合价美元上限；`off`/`0` 关闭。 | `8` |
| `KUNPENG_MAX_CONCURRENT_FLOWS` | 跨进程同时在跑的流上限；环境变量优先，`.kunpeng/budget.json` 的 `maxConcurrent` 次之。 | `4` |
| `KUNPENG_GIT_WALL_MS` | simple-git 单次阻塞操作的墙钟超时，单位为毫秒。 | `600000` |
| `KUNPENG_GUARD_TESTS` | 合并前守门测试筛选，逗号清单；`off`/`0` 关闭。 | 内置守门集 |
| `KUNPENG_HOME` | 鲲鹏自身资源根目录，用于宪法、角色卡和安装级资源。 | 由当前 orchestrator 安装位置推导 |
| `KUNPENG_HOST` | `kunpeng serve` 的监听地址；显式 `--host` 优先。 | `127.0.0.1` |
| `KUNPENG_HUMAN_EQUIV_COMPLEX` | 复杂任务的人工等价时间，单位为分钟。 | `90` |
| `KUNPENG_HUMAN_EQUIV_SIMPLE` | 简单任务的人工等价时间，单位为分钟。 | `25` |
| `KUNPENG_INSTANCE` | 当前 agent/实例身份，用于 presence、收件箱和并发协作。 | `.kunpeng-instance` 文件中的值；再无值时为 `main` |
| `KUNPENG_IN_FLOW` | loop 内部递归守卫标记；实现 agent 子进程会被内部设置为 `1`。 | 未设置；不要手工设置 |
| `KUNPENG_LOG` | 日志模式：`json` 输出 JSON 行，`debug` 开启 debug 级别。 | 人读格式，仅输出 warn/error |
| `KUNPENG_MERGE_PUSH_TIMEOUT_MS` | 合并后 push 的超时，单位为毫秒。 | `30000` |
| `KUNPENG_MERGE_TIERS` | `enforce` 时 autopilot 按分级表拦需人审的流；翻 `enforce` 须宪法 C5 第二类签字。 | `report`（只报不判） |
| `KUNPENG_MODEL_ROUTE` | 用 JSON 按 stage 覆盖模型与 reasoning effort 路由。 | 未设置，使用内置模型路由 |
| `KUNPENG_OPS_TOKEN_BUDGET` | ops loop 当月累计 token 上限。 | 未设置，不限额 |
| `KUNPENG_PROBE` | 选择设计 tier 探针：`playwright`、`agent` 或 `fake`。 | `playwright` |
| `KUNPENG_PTY_TMUX_TTL_MS` | tmux PTY 孤儿会话的清理 TTL，单位为毫秒。 | `604800000`（7 天） |
| `KUNPENG_RED_FIRST` | `0`/`off` 关闭实现前基线验收核查。 | 开启 |
| `KUNPENG_REPO` | 默认目标项目仓；全局 `--repo` 可覆盖。 | 当前工作目录 |
| `KUNPENG_REPOMAP_CONTEXT` | 值为 `1` 时给 spec 注入 repo-map 与相关经验。 | 关闭 |
| `KUNPENG_REQUIRE_SCOPE` | `=0` 回旧行为（只记警告）；CLI 入口由 `resolveRequireScope` 解析。 | 开启 |
| `KUNPENG_RUN_TOKEN_BUDGET` | 一次 `kunpeng run` 聚合 token 上限。 | 未设置，不限额 |
| `KUNPENG_RUN_USD_BUDGET` | 一次 `kunpeng run` 聚合美元上限。 | 未设置，不限额 |
| `KUNPENG_SERVE_RECONCILE_MS` | serve 对 flow 状态做周期 reconcile 的间隔，单位为毫秒。 | `600000` |
| `KUNPENG_SKILLS` | 当前实例自报的技能 ID，多个值用逗号分隔。 | 空列表 |
| `KUNPENG_STATE` | 跨项目状态目录；包含注册表、presence、插件、技能和默认 captures。 | `~/.kunpeng` |
| `KUNPENG_STATE_CAS` | `0` 关闭流状态乐观版本号冲突检测。 | 开启 |
| `KUNPENG_STATE_TTL_MS` | cockpit 多项目状态缓存 TTL，单位为毫秒。 | `3000` |
| `KUNPENG_UPDATE_URL` | 远程升级 manifest URL。 | 未设置；回退读取 `~/.kunpeng/update-channel.json`，仍无值则禁用远程通道 |

**常用配置**

原生或 systemd 部署通常至少设置：

```dotenv
KUNPENG_STATE=/var/lib/kunpeng
KUNPENG_REPO=/srv/target-repo
KUNPENG_BACKEND=codex
KUNPENG_HOST=127.0.0.1
```

`KUNPENG_HOME` 指向鲲鹏安装资源，`KUNPENG_REPO` 指向被管理项目，`KUNPENG_STATE` 指向跨项目运行状态，三者不要混用。

**安全说明**

- 不要把真实密码、token 或密钥提交到 `.env`；`KUNPENG_AUTH_PASSWORD` 只应短暂注入。
- codex 一律跑在 `workspace-write` 沙箱；联网（`KUNPENG_CODEX_NETWORK=1`）与额外可写目录（`KUNPENG_CODEX_WRITABLE_ROOTS`）必须显式声明，不再有整体豁免。
- 将 `KUNPENG_HOST` 设为 `0.0.0.0` 前，先配置 cockpit 密码、TLS、反向代理和防火墙。
- 修改 systemd 或容器环境变量后要重启服务才会生效。

**项目检查配置**

仓库根目录的 `.kunpeng/checks.json` 可按项目控制额外验证项。将 `lint` 设为 `true` 会在项目探测到 lint 脚本时，把 lint 接入自建循环的验证链，执行顺序为 typecheck、lint、test。`lint` 默认为 `false`；配置文件缺失、JSON 损坏或值不严格等于 `true` 时均不接入 lint。
