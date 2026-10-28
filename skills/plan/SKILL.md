---
name: plan
description: 鲲鹏 spec/plan 阶段方法论：把需求写成带可客观判定验收标准的 spec，并固定一条验收命令（C3）。
---

# plan 阶段方法论（spec）

为该需求产出 spec（含明确、可客观判定的验收标准）。最后单独输出一行：TESTCMD: <一条能客观验证这些验收标准的命令>。该命令将固定用于判定实现是否合格——实现者无权更改它（C3）。

<!-- host:codex -->
输出用纯文本，TESTCMD 那一行不要用 Markdown 代码围栏包裹。
<!-- /host -->
