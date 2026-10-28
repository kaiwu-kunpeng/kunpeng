# 后端账号与换人 SOP

鲲鹏可以为 Claude 和 Codex 后端配置多个登录态，并按后端、健康状态和用量选择账号。本页给出账号文件格式和安全换人的完整步骤。

## 账号文件在哪里

默认文件位于：

```text
<鲲鹏根>/.kunpeng/accounts.json
```

设置 `KUNPENG_ACCOUNTS` 后，可把账号文件放在任意指定路径：

```bash
export KUNPENG_ACCOUNTS="<账号配置文件路径>"
```

账号文件包含登录态目录位置等敏感运维信息。应限制文件权限，不要提交到项目仓库。

## accounts.json 字段

文件顶层是账号数组。每个账号支持以下字段：

- `id`：必填，必须是字符串，并且应保持唯一。
- `name`：可选，便于管理员识别的名称。
- `backend`：可选值为 `claude` 或 `codex`，表示账号服务于哪个后端。
- `env`：可选的字符串键值对，用于把凭证目录注入后端进程；值以 `~` 开头时会展开为当前用户家目录。
- `limit`：可选正数，表示用量窗口内允许的调用次数上限。
- `windowHours`：可选正数，表示用量窗口的小时数。

示例：

```json
[
  {
    "id": "claude-ops",
    "name": "Claude 运维号",
    "backend": "claude",
    "env": {
      "CLAUDE_CONFIG_DIR": "~/.credentials/claude-ops"
    },
    "limit": 100,
    "windowHours": 24
  },
  {
    "id": "codex-ops",
    "name": "Codex 运维号",
    "backend": "codex",
    "env": {
      "CODEX_HOME": "~/.credentials/codex-ops"
    },
    "limit": 80,
    "windowHours": 24
  }
]
```

## 凭证目录分别代表什么

Claude 账号通过 `CLAUDE_CONFIG_DIR` 指向配置目录。macOS 上，Claude 密钥实际可能保存在 Keychain 中，配置目录用于区分和定位相应的登录配置与 Keychain 条目。

Codex 账号通过 `CODEX_HOME` 指向独立目录。每个账号使用不同目录，避免两个登录态相互覆盖。

如果 `CLAUDE_CONFIG_DIR` 恰好等于默认的 `~/.claude`，或 `CODEX_HOME` 恰好等于默认的 `~/.codex`，鲲鹏加载配置时会自动剔除该环境变量。也就是说，“不注入”就是使用当前用户的默认登录态。

## 换人 SOP

### 第 1 步：为新账号建立独立凭证目录

选择家目录下一个只有当前管理员可读写的位置。例如：

```bash
mkdir -p ~/.credentials/<新账号目录>
chmod 700 ~/.credentials/<新账号目录>
```

不要复用旧账号目录。独立目录让验证、回退和删除旧账号都更安全。

### 第 2 步：在新目录内完成登录

Claude 示例：

```bash
CLAUDE_CONFIG_DIR=~/.credentials/<新账号目录> claude login
```

Codex 示例：

```bash
CODEX_HOME=~/.credentials/<新账号目录> codex login
```

后端 CLI 的登录入口可能随版本变化；如果上述子命令不被当前版本接受，以 `claude` 或 `codex` CLI 的实际登录提示和帮助为准。确认登录过程确实使用新目录，不要误写到默认登录态。

### 第 3 步：把新账号加入鲲鹏

Claude 示例：

```bash
kunpeng account add <新账号名> --backend claude --cred-dir ~/.credentials/<新账号目录> --limit 100 --window 24
```

Codex 时把后端改为 `codex`。`--limit` 和 `--window` 都可省略；需要配额控制时再填写。

添加后可运行 `kunpeng account list` 查看账号、后端、预检状态和当前窗口用量。

### 第 4 步：验证新账号

运行：

```bash
kunpeng account doctor
```

`account doctor` 会检查重定向的凭证目录是否存在、可读且非空。它是本地登录态预检，不等于向后端发起一次完整认证请求；正式换人前还应让新账号执行一次低风险真实任务，确认当前 CLI 登录仍有效。

### 第 5 步：摘掉旧账号

只有在新账号预检通过且真实调用成功后，才移除旧账号：

```bash
kunpeng account remove <旧账号id>
```

先摘账号配置，再按你自己的凭证保留策略归档或删除旧目录。删除凭证属于高风险操作，不要在尚未确认回退需求时执行。

## 配额窗口与选号规则

`limit` 与 `windowHours` 一起定义账号用量窗口：鲲鹏统计该账号窗口内跨模型的调用次数，达到 `limit` 后不再选择它，直到窗口重置。

选择账号时，鲲鹏先按请求后端筛选，再跳过不健康或已耗尽的账号，最后从可用账号中选择当前窗口用量最少的一个。用量相同的账号按配置顺序决定。

如果所有可用账号都达到上限，鲲鹏会报出配额耗尽，并提示最近的预计重置时间。

## 登录态预检如何失败

只要 `CLAUDE_CONFIG_DIR` 或 `CODEX_HOME` 指向的目录不存在、不可读或为空，对应账号就会被判为不健康。

单个账号不健康时，鲲鹏会输出 warn 并跳过它，继续尝试同一后端的其它健康账号。

同一后端所有匹配账号都不健康时，鲲鹏会直接报错，不会静默降级到坏账号，也不会假装任务已执行。

未配置重定向环境变量的账号使用默认登录态，因此目录预检视为健康；默认登录态是否仍获后端授权，仍要以一次真实调用为准。

## 日常检查建议

- 换人前后各保存一份不含密钥的账号清单，记录谁在何时完成变更。
- 定期运行 `kunpeng account list` 和 `kunpeng account doctor`。
- 账号异常时先修复凭证目录，不要通过放宽目录权限长期绕过问题。
- 任何不确定的账号命令选项，以当前 CLI 的实际命令帮助为准。

