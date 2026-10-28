# 环境变量参考

环境变量适合为常用路径、后端和运行身份提供默认值。临时覆盖可以只写在单条命令前，长期配置则应放入受控的 shell 或服务配置中。

## 变量表

| 变量名 | 作用 | 默认值 |
|---|---|---|
| `KUNPENG_HOME` | 指定鲲鹏自身资源根目录，包括宪法、角色卡和后台级 `.kunpeng` 数据 | 由当前鲲鹏安装位置推导 |
| `KUNPENG_STATE` | 指定跨项目运行状态目录，中央项目注册表也位于这里 | `~/.kunpeng` |
| `KUNPENG_REPO` | 指定默认目标项目仓库；作用类似全局 `--repo` | 当前工作目录 |
| `KUNPENG_HOST` | 指定 `kunpeng serve` 的监听地址；显式 `--host` 优先级更高 | `127.0.0.1` |
| `KUNPENG_BACKEND` | 强制 agent 使用 `claude` 或 `codex` 后端；未设置时允许按阶段路由 | 无默认（不设即不强制单一后端） |
| `KUNPENG_ACCOUNTS` | 覆盖账号池配置文件 `accounts.json` 的路径 | `<鲲鹏根>/.kunpeng/accounts.json` |
| `KUNPENG_INSTANCE` | 指定当前实例身份，用于 presence、收件箱和并发协作 | `.kunpeng-instance` 文件中的值；仍无值时为 `main` |
| `KUNPENG_AUTH_PASSWORD` | 为 `kunpeng auth set-password` 提供密码，避免把密码放在命令行参数中 | 无默认（未设置时从 stdin 读取） |
| `KUNPENG_ALLOW_INSECURE` | 值为 `1` 时允许未设密码却绑定非回环地址 | 无默认（不设即执行安全拒绝） |
| `KUNPENG_MODEL_ROUTE` | 用 JSON 按 stage 覆盖 Codex 的模型或 effort 路由 | 无默认（不设即使用内置阶段路由） |
| `KUNPENG_EXECUTION_BACKEND` | 选择执行位置；当前识别 `local` 与 `codex-cloud` | `local`，除非已有持久化后端偏好 |
| `KUNPENG_SKILLS` | 用逗号分隔当前实例自报的技能 ID，并写入 presence 心跳 | 空列表 |

## 路径变量的区别

`KUNPENG_HOME` 指向鲲鹏自身，`KUNPENG_REPO` 指向被管理的项目，二者不要混用。

`KUNPENG_STATE` 是跨项目状态目录；改变它会切换项目注册表、presence 和技能注册表等运行状态的落点。

`KUNPENG_ACCOUNTS` 只覆盖账号文件，不会连带移动整个状态目录。

## 优先级与示例

命令行显式选项通常高于环境变量。例如 `kunpeng serve 7777 --host 0.0.0.0` 会覆盖 `KUNPENG_HOST`，`--repo <路径>` 会覆盖 `KUNPENG_REPO`。

只对一条命令生效：

```bash
KUNPENG_HOST=127.0.0.1 KUNPENG_REPO=<项目路径> kunpeng serve 7777
```

强制某个后端：

```bash
KUNPENG_BACKEND=codex kunpeng run "<任务描述>" --repo <项目路径>
```

自报多个技能：

```bash
KUNPENG_SKILLS="review,security,docs" kunpeng status --repo <项目路径>
```

## 安全注意事项

不要把真实密码、token 或密钥直接写进可提交的环境文件。`KUNPENG_AUTH_PASSWORD` 只应在设置密码时短暂存在。

修改后台服务的环境变量后，需要重启相应进程才能生效。由 launchd 启动的任务不会自动继承交互式 shell 的完整环境，应在服务配置里显式提供所需变量。

版本升级后若变量行为与本表不一致，以当前 CLI 的实际命令和运行输出为准。

