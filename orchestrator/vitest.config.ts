import { defineConfig, configDefaults } from "vitest/config";

// 真 e2e/浏览器测试(*.e2e.test.ts)默认不进套件：它们起真子进程/真 Playwright，
// 在多实例并发负载下会 flaky，被 per-flow 差分门(newFailures)误判成「基线外新失败」→ flow 假回滚。
// 需要时用 KP_E2E=1 显式触发(集成门/专用 e2e 跑)。per-file 的 describe.runIf(KP_E2E) 仍兼容、做双保险。
const e2e = process.env.KP_E2E === "1";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...(e2e ? [] : ["**/*.e2e.test.ts"])],
    setupFiles: ["./test/vitest-setup.ts"],
  },
});
