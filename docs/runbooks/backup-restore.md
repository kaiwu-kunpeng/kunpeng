# 鲲鹏备份与恢复手册

本文说明如何备份鲲鹏运行状态、中央知识库和项目内产物，以及如何在误删或机器迁移后恢复。
以下命令按默认状态目录 `~/.kunpeng/` 编写；如设置了 `KUNPENG_STATE`，请用实际目录替换。

## 备份范围

完整备份应同时包含全局状态和每个目标仓库的本地状态。

- `~/.kunpeng/projects.json`：已登记项目及其路径。
- `~/.kunpeng/auth.json`：驾驶舱账号认证配置，其中包含密码派生 hash，仍应按敏感数据处理。
- `~/.kunpeng/localfs-authz.json`：localfs 会话授权登记。
- `~/.kunpeng/` 下各项目的 FlowState、运行记录和其他状态文件。
- `~/.kunpeng/captures/`：中央知识库；不同 remote 对应独立的 `kunpeng-<hash>` 目录。
- 每个目标仓库自身的 `.kunpeng/`：项目身份、flow 产物、日志及其他项目内真相源。
- 如启用了多账号执行，还应备份实际使用的 `accounts.json`。

不要只备份代码仓库。中央状态和仓库内 `.kunpeng/` 的用途不同，缺少任何一边都可能让恢复后的项目索引或历史 flow 不完整。

## 使用 tar 做快照

先暂停正在写入状态的鲲鹏进程，再创建权限收紧的备份目录：

```bash
umask 077
backup_dir="$HOME/kunpeng-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
tar -czf "$backup_dir/kunpeng-state.tgz" -C "$HOME" .kunpeng
tar -czf "$backup_dir/project-state.tgz" -C "/path/to/project" .kunpeng
```

每个纳管仓库都应单独生成一份 `project-state.tgz`，或在文件名中加入项目标识。
创建后可用 `tar -tzf <归档文件>` 检查清单，确认 `projects.json`、`captures` 和项目 `.kunpeng/` 均在预期位置。

## 使用 rsync 做增量副本

也可以把状态同步到已加密、仅备份账号可访问的卷：

```bash
umask 077
rsync -a "$HOME/.kunpeng/" "/encrypted-backup/kunpeng/state/"
rsync -a "/path/to/project/.kunpeng/" "/encrypted-backup/kunpeng/projects/project-name/"
```

首次演练前不要加入 `--delete`；源目录误删时，带删除同步会把错误传播到备份。
远端备份必须通过受控加密通道传输，并限制备份端目录权限。

## 频率与保留策略

- 活跃开发期：每天至少一次增量备份，重要 flow 完成后追加一次快照。
- 低频使用期：每周一次，并在升级、迁移或批量清理前手动快照。
- 建议保留每日 7 份、每周 4 份和每月若干份，避免单一坏快照覆盖全部历史。
- 每月至少做一次抽样恢复演练；“能生成归档”不等于“能恢复”。

`auth.json`、`accounts.json` 和其他账号资料不得放进公开仓库或未加密网盘。
即使 `auth.json` 保存的是 hash 而不是明文密码，它仍可能泄露账号名称、认证配置和离线攻击材料。

## 标准恢复步骤

1. 停止 `kunpeng serve` 及其他会写入状态目录的进程。
2. 把当前损坏目录改名保留，不要直接覆盖唯一现场。
3. 在临时目录解开归档，先确认层级没有多一层 `.kunpeng/.kunpeng`。
4. 将全局状态还原到 `~/.kunpeng/`，并将各项目快照还原到对应仓库的 `.kunpeng/`。
5. 将目录权限设为仅当前用户可访问；敏感 JSON 文件建议设为 `0600`。
6. 校验 `projects.json` 是合法 JSON，且其中项目路径在新机器上真实存在。
7. 核对 `captures/kunpeng-<hash>` 目录可读，必要时检查其中 Git 仓库状态。
8. 核对各项目 FlowState、产物索引和项目身份文件均已恢复。
9. 重新启动 `kunpeng serve`，打开驾驶舱确认项目列表、flow 和知识库可见。
10. 在确认新实例正常前，保留步骤 2 的损坏目录和原始归档。

机器迁移时，项目绝对路径可能变化。
先把仓库复制到新位置，再更新 `projects.json` 中的路径；不要为了让旧路径“看起来存在”而把多个项目指向同一目录。
浏览器 localfs 目录句柄属于原浏览器环境，迁移状态文件后仍可能需要用户在新机器上重新授权。

## 误删中央知识库

若只是工作树文件误删，而对应对象已写入 captures 内部 Git 对象库，可先停止写入并复制整个受损目录。
然后在副本中使用 `git status`、`git log --all` 和 `git fsck --lost-found` 查找仍可达或悬空的对象。
找到候选 blob 后，用 `git show <blob-id>` 检查内容，再输出到新的恢复目录；不要直接写回唯一受损现场。

未提交、未形成 Git blob 或已被垃圾回收的内容不能保证从对象库找回，因此 Git 找回只能作为灾难补救，不能代替常规备份。
若知识库目录整体丢失，应从最近快照恢复 `~/.kunpeng/captures/`，再核对快照之后是否还有可从项目仓库重新 capture 的资料。

## 恢复验收清单

- 驾驶舱能列出预期项目，且路径指向正确仓库。
- 最近的 flow 状态和标准产物可读取。
- 中央知识库查询能命中恢复前的抽样资料。
- 新建一条非敏感测试记录后，状态目录能够正常写入。
- 备份副本、恢复日志和敏感文件均未进入公开版本控制。
