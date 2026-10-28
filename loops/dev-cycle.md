# Loop · 开发循环（主循环）

确定性状态机，每个 stage 内调一个小 agent（宪法 C8）。

| stage | 角色 | 产出 | 通过条件 |
|---|---|---|---|
| spec | 产品 | spec(approved) | 验收标准明确、非目标清晰 |
| 设计 | 设计 | plan | 步骤+风险+回滚方案齐 |
| 实现 | 开发(持写锁) | code + task(in-progress) | TDD 红→绿→重构 |
| 评审 | 评审 | review | findings 已处理或豁免 |
| 测试 | 测试 | 测试结果 | 真跑通过(C3) |
| 审计 | 测试审计 | verdict | 完成定义全满足；不过则打回"实现" |
| 完工 | — | spec(verified) | 等待人工门 #1(合并主干) |

并行：多条 dev-cycle 各自 worktree 隔离（单写者 C1）。简单需求可走单线程直做，不展开全队。
