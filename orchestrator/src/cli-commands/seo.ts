import { join } from "node:path";
import { buildSiteReport, writeSiteReport } from "../seo/report.js";
import { runSeoServe } from "../seo/serve-cmd.js";
import { registerCliCommand, type CliContext } from "./registry.js";

const USAGE = "用法: kunpeng seo-mcp <serve|report <origin>> [--repo <仓库>] [--out <目录>] [--max-pages N]";

registerCliCommand({
  name: "seo-mcp",
  run: async (context: CliContext) => {
    if (context.rest[0] === "serve") {
      await runSeoServe(context.repoRoot);
      return;
    }
    if (context.rest[0] === "report") {
      const origin = context.rest[1];
      if (typeof origin !== "string" || !/^https?:\/\//.test(origin)) {
        console.error(USAGE);
        process.exit(1);
      }
      const outDir = context.outArg ?? join(context.repoRoot, ".kunpeng", "seo-reports");
      const maxPagesIndex = context.argv.indexOf("--max-pages");
      const maxPages = maxPagesIndex < 0 ? NaN : Number(context.argv[maxPagesIndex + 1]);
      const report = await buildSiteReport({
        origin,
        ...(Number.isFinite(maxPages) && maxPages > 0 ? { maxPages } : {}),
      });
      const files = await writeSiteReport(report, outDir);
      console.log(`报告：${files.markdownPath}`);
      console.log(`JSON：${files.jsonPath}`);
      const light = report.totals.ok ? "✅ 通过" : "❌ 未通过";
      console.log(`总灯：${light}（error ${report.totals.errors} / warn ${report.totals.warns} / info ${report.totals.infos}），抓取 ${report.crawl.pageCount} 页`);
      for (const layer of report.layers) {
        console.log(`  ${layer.ok ? "✅" : "❌"} ${layer.label}：error ${layer.errors} / warn ${layer.warns}`);
      }
      return;
    }
    console.error(USAGE);
    process.exit(1);
  },
});
