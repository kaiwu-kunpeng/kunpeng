import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { kunpengStateDir } from "../project/state-dir.js";
import { newMessage, SwitchboardStore, type SwitchboardSender } from "./store.js";

/** 生产缺省发送器：将生命周期通知落到总机文件邮箱，测试仍可注入假 sender。 */
export function fileSwitchboardSender(dir: string = join(kunpengStateDir(), "switchboard")): SwitchboardSender {
  const store = new SwitchboardStore(dir);
  return {
    send: async (input) => store.append(newMessage(input, {
      now: Date.now,
      id: () => `msg-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    })),
  };
}
