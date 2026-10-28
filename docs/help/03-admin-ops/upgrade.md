# 版本查看与升级

鲲鹏支持查看当前版本、检查远程升级通道和下载升级包。本功能不会自动安装升级；安装与重启仍由管理员手动完成。

## 查看版本

在命令行查看鲲鹏 orchestrator、Node.js 和运行平台版本：

```sh
kunpeng version
```

cockpit 运行时也可请求版本接口：

```http
GET /api/version
```

接口返回 `version`、`node` 和 `platform` 字段的 JSON。

## 配置远程升级通道

首选方式是设置环境变量：

```sh
export KUNPENG_UPDATE_URL="https://example.com/kunpeng/manifest.json"
```

也可以创建 `~/.kunpeng/update-channel.json`：

```json
{
  "manifestUrl": "https://example.com/kunpeng/manifest.json"
}
```

环境变量 `KUNPENG_UPDATE_URL` 的优先级高于配置文件。远程 manifest 的 JSON 结构如下，其中 `url` 和 `notes` 可省略：

```json
{
  "version": "1.2.3",
  "url": "https://example.com/kunpeng/kunpeng-1.2.3.tgz",
  "notes": "本次升级的说明"
}
```

## 检查、下载与应用

- `kunpeng upgrade` 或 `kunpeng upgrade --check`：读取通道清单，显示当前版本、最新版本和是否可升级。
- `kunpeng upgrade --download`：先检查版本；有新版本且 manifest 提供 `url` 时，将升级包下载到 `~/.kunpeng/updates/<version>/`，随后打印手动安装指引。
- `kunpeng upgrade --apply`：只打印 git 检出和 tgz 包的升级指引。该参数是预留接口，当前不自动执行安装。

未配置远程通道时，命令会提示配置 `KUNPENG_UPDATE_URL` 或 `~/.kunpeng/update-channel.json`，并给出 git 检出的替代升级路径。

## git 检出方式升级

在鲲鹏仓库中运行：

```sh
git pull && npm install
```

`npm install` 会通过 `prepare` 自动重建产物。命令完成后，重启正在运行的 `kunpeng serve`。
