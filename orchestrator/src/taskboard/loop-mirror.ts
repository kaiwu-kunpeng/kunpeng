import { TaskBoard } from "./store.js";

export interface FlowMirror {
  onStart(flowId: string, subject: string): Promise<void>;
  onEnd(flowId: string, verified: boolean): Promise<void>;
}

export function makeTaskBoardMirror(board: TaskBoard, owner: string): FlowMirror {
  const taskIds = new Map<string, string>();

  return {
    async onStart(flowId: string, subject: string): Promise<void> {
      try {
        const task = await board.create({
          subject: subject.slice(0, 120) || flowId,
          description: `Loop flow: ${flowId}`,
          createdBy: owner,
        });
        await board.claim(task.id, owner);
        taskIds.set(flowId, task.id);
      } catch {
        // 镜像是旁路可观测性，失败不得阻断真实 flow。
      }
    },

    async onEnd(flowId: string, verified: boolean): Promise<void> {
      try {
        const taskId = taskIds.get(flowId);
        if (taskId === undefined) return;
        if (verified) await board.complete(taskId);
        else await board.reclaim(taskId);
        taskIds.delete(flowId);
      } catch {
        // 保留映射供调用方重试，同时不改变真实 flow 的结果。
      }
    },
  };
}

export function noopMirror(): FlowMirror {
  return {
    async onStart(): Promise<void> {},
    async onEnd(): Promise<void> {},
  };
}
