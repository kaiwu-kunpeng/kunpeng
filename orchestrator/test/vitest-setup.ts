import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 测试隔离：绝不让测试读到真实 ~/.kunpeng。
// 否则会撞用户的真实状态（尤其 auth.json：cockpit 启用密码后，readAuthConfig
// 经 kunpengStateDir() 退回 ~/.kunpeng 读到它 → 鉴权中间件对所有 /api 返 401 →
// 一切不带认证的端点测试全红）。每个测试文件用独立临时 KUNPENG_STATE；
// 若调用方已显式设置（如 CI），尊重不覆盖。
if (!process.env.KUNPENG_STATE) {
  process.env.KUNPENG_STATE = mkdtempSync(join(tmpdir(), "kunpeng-test-state-"));
}
