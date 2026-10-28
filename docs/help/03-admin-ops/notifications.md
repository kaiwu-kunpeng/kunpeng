# 配置手机推送

鲲鹏可在出现待处理合并门时，把通知发到手机。配置文件是 `~/.kunpeng/notify.json`。

## 完整配置示例

四个通道全部可选，填了哪个就推哪个，可以同时配置：

```json
{
  "cockpitUrl": "https://<你的总控台域名>",
  "telegram": {
    "token": "<Telegram Bot Token>",
    "chatId": "<Telegram Chat ID>"
  },
  "serverChan": "<Server酱 sendkey>",
  "wxpusher": {
    "appToken": "<WxPusher appToken>",
    "uid": "<WxPusher UID>"
  },
  "wechatWebhook": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<企业微信群机器人key>"
}
```

不要把这份文件提交到仓库，也不要在截图或日志中暴露 token、sendkey、UID 或 webhook key。

## 四种通道怎么选

- `telegram`：需要成对填写 bot `token` 和 `chatId`。
- `serverChan`：填写 Server酱 `sendkey`，用于推送到个人微信。
- `wxpusher`：需要成对填写 `appToken` 和 `uid`，用于推送到个人微信。
- `wechatWebhook`：填写企业微信群机器人 webhook，适合企业微信群。

某个通道字段不完整时，该通道不会发送；其它配置完整的通道仍可工作。

## cockpitUrl 的作用

`cockpitUrl` 是用户可访问的总控台根地址。鲲鹏用它生成指向总控台收件箱的审批深链。

远程审批时应填写经过 HTTPS 保护、手机实际可达的地址，不要填写仅服务器本机可访问的 `localhost`。

未配置 `cockpitUrl` 时，消息仍可能发出，但“打开总控台”链接会是空地址拼出的相对结果，不能作为可用的远程审批链接。

## 发送与失败边界

外部通知采用 best-effort：已配置的通道并行发送，单通道失败不会阻断其它通道，也不会中断工作流。

当前四个外部通道的发送路径没有承诺自动重试，也没有统一的约 10 秒超时保证；不要把通知通道当作唯一告警来源。浏览器 Web Push 是另一条机制，其网络请求有约 10 秒超时，不能与本页四通道混为一谈。

调用入口会把推送作为尽力而为的旁路处理。运维时仍应查看总控台收件箱，不要仅凭“手机没收到”判断没有待处理事项。

## 常见问题排查

1. 检查 JSON 是否能正常解析，字段名大小写是否与示例完全一致。
2. 检查 token、chatId、sendkey、appToken、uid 或 webhook URL 是否填错或已失效。
3. 检查服务器能否访问对应平台；受限网络、DNS 或代理配置都可能导致失败。
4. 检查 `cockpitUrl` 是否为手机可访问的 HTTPS 地址；未配置会导致审批链接不可点。
5. 分别只保留一个通道做测试，定位是公共网络问题还是单个平台配置问题。
6. 失败不会停止鲲鹏流程；请结合进程日志和总控台收件箱继续排查。

