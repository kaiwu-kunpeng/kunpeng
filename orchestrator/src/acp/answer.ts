/** ACP /answer：给 agent 主动求助（raise-blocker）的流写回复并从 checkpoint 续跑。
 *  与驾驶舱「回复并续跑」同一条链路：addFeedback（resume 时注入给 agent）→ clearPause → kunpeng resume。 */
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { clearPause } from "../runtime/pause-marker.js";
import { isRaiseBlocker } from "../runtime/raise-blocker.js";
import { addFeedback } from "../runtime/review-feedback.js";
import { resumeArgs } from "../server/launch.js";

export interface AnswerBlockerDeps {
  /** 启动 kunpeng 子命令（生产为 launchKunpeng），返回 pid 与日志路径。 */
  launch(args: string[], cwd: string): { pid: number; logPath: string };
}

export async function answerRaisedBlocker(
  repoRoot: string,
  flowId: string,
  reply: string,
  deps: AnswerBlockerDeps,
): Promise<{ ok: boolean; message: string }> {
  const text = reply.trim();
  if (!text) return { ok: false, message: "回复不能为空" };
  const flow = await new FlowTracker(resolveProjectStateDir(repoRoot)).read(flowId);
  if (!flow) return { ok: false, message: `没有这条流：${flowId}` };
  if (!isRaiseBlocker(flow.blocker)) return { ok: false, message: `${flowId} 当前没有等待答复的求助` };
  await addFeedback(repoRoot, flowId, { comment: text });
  await clearPause(repoRoot, flowId);
  const { pid, logPath } = deps.launch(resumeArgs(flowId, repoRoot), repoRoot);
  return { ok: true, message: `已答复并续跑 ${flowId}（pid ${pid}），日志：${logPath}` };
}
