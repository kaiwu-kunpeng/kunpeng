# 插件、技能与 MCP

鲲鹏插件把一组技能和 MCP server 声明装进一个本地目录，便于统一登记、启用和停用。
插件管理只接受本地目录；如果插件来自 Git 仓库，请先自行克隆到本地，再执行登记。

## 插件包格式

插件目录的根部必须包含 `kunpeng-plugin.json`。
默认情况下，技能放在 `skills/`，MCP 声明放在 `.mcp.json`。
一个典型目录如下：

```text
my-plugin/
├── kunpeng-plugin.json
├── skills/
│   └── release-check/
│       └── SKILL.md
└── .mcp.json
```

`kunpeng-plugin.json` 支持六个字段：

| 字段 | 必填 | 含义 | 默认值 |
| --- | --- | --- | --- |
| `name` | 是 | 插件名，只能使用小写字母、数字和连字符 | 无 |
| `version` | 是 | 插件的语义版本 | 无 |
| `description` | 否 | 插件说明 | 无 |
| `minKunpengVersion` | 否 | 所需的最低鲲鹏版本 | 不限制 |
| `skillsDir` | 否 | 相对插件根目录的技能目录 | `skills` |
| `mcpConfig` | 否 | 相对插件根目录的 MCP 配置文件 | `.mcp.json` |

例如：

```json
{
  "name": "release-tools",
  "version": "1.0.0",
  "description": "发布检查工具集",
  "minKunpengVersion": "0.1.0",
  "skillsDir": "skills",
  "mcpConfig": ".mcp.json"
}
```

每个技能占一个子目录，并以 `skills/<名称>/SKILL.md` 作为入口。
如果用 `skillsDir` 改了默认目录，仍需保持“每个技能一个子目录、子目录内含 `SKILL.md`”的结构。
MCP 配置文件必须是 JSON 对象，并包含 `mcpServers` 对象。

```json
{
  "mcpServers": {
    "local-docs": {
      "command": "local-docs-server",
      "args": ["--root", "./docs"]
    }
  }
}
```

执行 `kunpeng plugin add` 时会检查 manifest，并用 `minKunpengVersion` 校验兼容性。
当前版本低于最低版本时，登记会直接失败，而不是留下一个不可用的插件记录。

## 插件管理

插件的安装登记与启用是两个独立动作。
`kunpeng plugin add <本地目录>` 只登记插件，初始状态为 disabled，不会立刻加载技能或 MCP。
需要登记后立即启用时，可运行 `kunpeng plugin add <本地目录> --enable`。

- `add <本地目录> [--enable]`：校验并登记本地插件；可选立即启用。
- `list`：列出已登记插件的名称、版本、状态、目录以及技能和 MCP 数量。
- `enable <name>`：启用插件并登记它提供的技能与 MCP server。
- `disable <name>`：停用插件，并停用此前由该插件登记的技能与 MCP server。
- `remove <name>`：先停用再移除登记；插件的本地磁盘目录会保留。

```bash
kunpeng plugin add ./plugins/release-tools
kunpeng plugin list
kunpeng plugin enable release-tools
kunpeng plugin disable release-tools
kunpeng plugin remove release-tools
```

启用插件时，鲲鹏扫描 `skillsDir` 下含 `SKILL.md` 的子目录。
这些技能自动登记为 `origin=vendored`，并进入启用状态。
鲲鹏同时读取 `mcpConfig` 的 `mcpServers`，将其中条目登记为 `origin=plugin` 并启用。
停用插件时，这两类关联条目会一并变成 disabled。
启用插件后仍需运行 `kunpeng mcp sync`，才能把已启用 MCP 汇总到共享配置。

## MCP 管理

`kunpeng mcp` 管理独立登记或由插件带入的 MCP server。
它提供六个子命令：

- `list`：列出 MCP server 的 ID、名称、传输方式、启用状态、来源和连接详情。
- `add <id> ...`：登记一个 HTTP 或 stdio MCP server，默认立即启用。
- `remove <id>`：移除指定 MCP server 的登记。
- `enable <id>`：启用已登记的 MCP server。
- `disable <id>`：停用已登记的 MCP server。
- `sync [--refresh]`：把启用条目汇总为共享基础配置。

`add` 的完整形式是：

```text
kunpeng mcp add <id> (--url <url> | --command <bin>) [--arg <v> ...] [--name <名>] [--env K=V ...] [--header K=V ...] [--disabled]
```

`--url` 登记 HTTP server，`--command` 登记 stdio server，两者只能选一个。
`--arg` 可重复，用来依次追加 stdio 命令参数。
`--name` 设置便于阅读的展示名。
`--env K=V` 可重复，为 stdio server 提供环境变量映射。
`--header K=V` 可重复，为 HTTP server 提供请求头映射。
`--disabled` 让新条目以停用状态登记。

```bash
kunpeng mcp add docs --command local-docs-server --arg --root --arg ./docs --name "本地文档"
kunpeng mcp add tickets --url https://mcp.example.test --header 'Authorization=Bearer ${TICKETS_TOKEN}'
kunpeng mcp disable tickets
kunpeng mcp enable tickets
kunpeng mcp remove tickets
```

## MCP 生效链

MCP 配置按以下链路生效：注册表 → `mcp-base.json` → profile `mcp.json` → 后端调用。

1. `add`、插件启用或状态命令先更新 MCP 注册表。
2. `kunpeng mcp sync` 把当前启用条目写入 `~/.kunpeng/shared/mcp-base.json`。
3. 某个 profile 下次运行时，如果还没有自己的 `mcp.json`，鲲鹏才从共享基础配置惰性生成它。
4. 已存在的 profile `mcp.json` 不会被普通运行覆盖；生成失败也不会阻断本次 agent 运行。
5. Claude 后端收到 profile 配置路径后，会追加 `--mcp-config <path> --strict-mcp-config`。

`kunpeng mcp sync --refresh` 会先写共享 `mcp-base.json`，再删除各 profile 已有的 `mcp.json`。
这样各 profile 会在下次运行时依据最新共享配置重新生成，而不是继续使用旧文件。

当前 codex 后端不消费 MCP 配置路径，也不会追加与 MCP 有关的启动参数。
因此，上述 MCP 生效链目前只会把配置实际接入 Claude 后端；不要把登记或同步成功误解为 codex 已支持 MCP。

## 凭证纪律

不要把真实令牌、密码或 API key 写进插件的 `.mcp.json` 或 MCP 注册表。
`--env` 和 `--header` 的值应使用 `"${VAR}"` 形式的环境变量占位符。
真实密钥只放在运行环境变量中，由执行时的环境解析提供。

```bash
export TICKETS_TOKEN='由你的密钥管理方式注入'
kunpeng mcp add tickets --url https://mcp.example.test --header 'Authorization=Bearer ${TICKETS_TOKEN}'
kunpeng mcp sync --refresh
```

检查登记内容时，应确认注册表和生成的配置里只有占位符，没有真实密钥。
