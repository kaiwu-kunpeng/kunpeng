import { resolveProjectStateDir } from "../project/state-resolve.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { launchKunpeng, runArgs } from "../server/launch.js";
import { runAcpStdio } from "../acp/agent.js";
import { answerRaisedBlocker } from "../acp/answer.js";
import { isRaiseBlocker, raiseBlockerReason } from "../runtime/raise-blocker.js";
import { registerCliCommand } from "./registry.js";
import { cliJsPath } from "./shared.js";
import { kunpengVersion } from "../runtime/version.js";

registerCliCommand({
  name: "acp",
  run: async () => {
    // stdout 只留给 ACP 协议消息；本命令里的日志一律 console.error。
    await runAcpStdio(process.stdin, process.stdout, {
      version: kunpengVersion(),
      listFlows: async (cwd) => (await new FlowTracker(resolveProjectStateDir(cwd)).list()).map((flow) => ({
        flowId: flow.flowId,
        status: flow.status,
        stage: flow.stage,
        updatedAt: flow.updatedAt ?? flow.startedAt,
        ...(flow.blocker ? { blocker: raiseBlockerReason(flow.blocker) } : {}),
        ...(isRaiseBlocker(flow.blocker) ? { raisedBlocker: true } : {}),
        ...(flow.humanGate ? { gate: flow.humanGate.gate } : {}),
      })),
      dispatch: async (cwd, specPath, acceptCmd) =>
        launchKunpeng({ execPath: process.execPath, cliJs: cliJsPath() }, runArgs(specPath, cwd, acceptCmd), cwd),
      answerBlocker: (cwd, flowId, reply) => answerRaisedBlocker(cwd, flowId, reply, {
        launch: (args, at) => launchKunpeng({ execPath: process.execPath, cliJs: cliJsPath() }, args, at),
      }),
    });
  },
});
