export const RAISE_BLOCKER_PREFIX = "raise-blocker: ";

export const RAISE_BLOCKER_INSTRUCTION: string =
  "只有以下三类情况导致无法继续时才可求助：①缺凭据/密钥；②需要人做产品或范围决策；③目标外部环境不可达（数据库/远端服务）。不要猜、不要绕；最后单独输出一行 RAISE_BLOCKER: <一句话说明缺什么、需要人做什么>，然后停止。以下四条不是求助理由：①作者锁定测试在实现前失败或导入缺失，是预期的先红后绿，继续实现；②沙箱内跑不了测试或写缓存被拒，验收由编排方在沙箱外跑，照常实现；③.kunpeng/ 下登记文件等范围外改动由编排方产生，忽略；④spec 有歧义但任一合理解释都能落地，按最保守的实现。求助前自问：换一个有经验的工程师，他会停下来问吗？能自己解决的问题不要使用此标记。";

export function parseRaiseBlocker(text: string): string | undefined {
  if (typeof text !== "string") return undefined;
  let reason: string | undefined;
  for (const match of text.matchAll(/^[ \t]*RAISE_BLOCKER:[ \t]*(.+?)[ \t]*$/gm)) {
    reason = match[1]?.trim() || undefined;
  }
  return reason;
}

export function isRaiseBlocker(blocker: string | undefined): boolean {
  return typeof blocker === "string" && blocker.startsWith(RAISE_BLOCKER_PREFIX);
}

export function raiseBlockerReason(blocker: string): string {
  return blocker.startsWith(RAISE_BLOCKER_PREFIX) ? blocker.slice(RAISE_BLOCKER_PREFIX.length) : blocker;
}
