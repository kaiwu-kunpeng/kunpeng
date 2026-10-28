# ADR-0013 v2: 跨实例可认领任务队列(按 Agent Teams 数据面重做)

状态: 已接受(2026-07-13,取代 v1 的 A2A 协议完整版)
关联: ADR-0009 并发治理 / switchboard / SOTA吸收波

## 背景

v1(A2A parts/TaskState 折叠/memoryScope 完整协议)是为尚不存在的消费者做的过度设计。深挖 Claude Code Agent Teams(2026-07 官方,逆向到文件格式)发现:官方多实例协作用最土的零依赖方案——per-task JSON + flock 认领 + highwatermark 自增 id + blocks/blockedBy 依赖——就撑起整套协作。与 ADR-0013 已否决 Redis/HTTP-SDK 的零依赖结论同向,但证明不需要 A2A 协议完整性就能跑通。现有 switchboard task-store/task 是 message 派生投影(只读),不是可认领写队列——最大缺口。

## 决策

新建 TaskBoard(`<projectStateDir>/taskboard/`,走 resolveProjectStateDir),按 Agent Teams 数据面:每任务一文件 {id}.json(id/subject/description/owner/status[pending|in_progress|completed|deleted]/blocks[]/blockedBy[]/projectId/flowId?/createdBy/claimedAt?/completedAt?);.highwatermark 自增 id;.lock 0字节 flock+30s 陈锁超时;认领规则 blockedBy 全终态才可 claim、最小 id 优先、lead 可指派;CLI task create|claim|complete|list|show。

## 从 Agent Teams 学但反超三点

1. 心跳判死→任务自动回 pending(S4):AT 头号坑=teammate 崩溃依赖链永久卡死;我们 members.json lastSeen+pid 扫描判死即释放。
2. 完成门 exit 2(S3):标 completed 那刻跑门脚本 exit 2 拒绝+反馈回喂;门故障≠任务失败(吸差分门被 flaky 击穿旧坑)。
3. 陈锁超时:AT flock 无超时,崩在持锁死锁;我们 30s 抢占。

## 绝不抄三点

会话级 team 生命周期(必须 HOME 级持久)、无写隔离靠 prompt 约定(worktree+合并门是命门)、JSON-in-JSON 编码(AT 崩溃循环温床)。

## 保留 v1 差异化(排到有真实消费者后)

memoryScope(省 token,AT 没有)、任务折叠/历史压缩(AT 任务无历史)。

## 落地顺序

S2 TaskBoard 内核→S3 完成门→S4 心跳判死→接 cockpit 任务台读写。S1 消息协议化已落 main。
