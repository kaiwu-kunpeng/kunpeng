# 0007 · 登录态 CLI、零 API key

**Status**: Accepted（2026-06-13）

## Context

子 agent 需要一个 LLM 后端来干活。常规做法是用 API key 调云端 API，但这带来几个问题：要管理、存储、轮换密钥（密钥入库或泄漏是常见事故）；要为 token 直接付费；还要绕开用户已经登录的 CLI 工具（claude / codex）单独搭一套认证。而用户机器上的 `claude` / `codex` 命令行**本就是登录态**，可以直接驱动，零密钥、零额外计费配置。

但「直接驱动 CLI」踩过坑：**codex 在无 TTY 环境下会因等待审批而挂死**——它默认要交互式确认危险操作，子 agent 是非交互子进程，没有 TTY 也没人去按确认，于是进程永久 hang（JOURNAL/经验里的 codex hang 教训）。

## Decision

1. **子 agent 后端一律走登录态 CLI、不碰 API key**：用 `claude -p` / `codex exec` 作后端（`KUNPENG_BACKEND` ∈ `claude`(默认) / `codex`），复用用户已登录的 CLI 会话。仓库零 `.env`、零密钥，最小暴露面。
2. **针对 codex 无 TTY 挂死**：调用 codex 时加 `--dangerously-bypass-approvals-and-sandbox`（不再等交互审批）并把 **stdin 设为 `ignore`**（不留一个等待输入的句柄）。
3. **所有后端调用带超时**，到点 `SIGKILL` + reject，绝不无限等待（fail-closed）。

## Consequences

- **换来**：零密钥管理、零密钥泄漏面、零额外计费配置；直接复用用户登录态；codex 后端可在非交互子进程里稳定跑而不 hang。
- **成本**：依赖用户机器上 CLI 已登录且可用（环境耦合，CI 里要另想办法）；`--dangerously-bypass-approvals-and-sandbox` 字面上很危险——之所以可接受，是因为外层已有 worktree 隔离（0001）、可逆性（C4）、三道人工门（0004）兜底，沙箱审批这层在「鲲鹏自己已经管住边界」的前提下是冗余且会致命挂死的，故主动绕过。
- **约束**：新增后端必须同样满足「登录态、无 TTY 可跑、带超时」三条，否则会重蹈 codex hang。
