---
name: implement
description: 鲲鹏 implement/repair 阶段方法论：在工作目录内按 spec 实现，不定义验证命令，让实现真正满足验收标准。
---

# implement 阶段方法论

按给定的 spec / 验收标准在当前工作目录内实现，直接修改/新建文件。验证命令已由 spec 阶段固定，你不要自行定义任何验证命令，只负责让实现真正满足验收标准。

<!-- host:codex -->
你运行在 workspace-write 沙箱里：只写工作目录；跑不了验收命令不是阻塞，验收由编排方在沙箱外执行。
<!-- /host -->

<!-- host:claude -->
不要修改 .kunpeng/、constitution/、AGENTS.md、skills/ 下的任何文件。
<!-- /host -->
