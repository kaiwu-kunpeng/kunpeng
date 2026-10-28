import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { CliRunner } from "../agent/cli-runner.js";
import { ArtifactStore } from "../artifacts/store.js";
import { writeBoard } from "../board/write-board.js";
import { readWatchList, addWatch } from "../board/watch.js";
import { reclaimReposBestEffort } from "../git/workspace.js";
import { loadExternalRecipes } from "../loop/recipe-loader.js";
import { kunpengStateDir, readRegistry, readProjectSelf } from "../project/registry.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { formatSuggestions } from "../project/scout-format.js";
import { recordAndWarn } from "../metrics/loop-yield-record.js";
import { AgentResearcher } from "../research/researcher.js";
import { checkDepsSync } from "../runtime/deps-check.js";
import { daemonPlatform, installDaemonSchedule, uninstallDaemonSchedule, realDaemonIo } from "../runtime/daemon-schedule.js";
import { installProcessGuards } from "../runtime/process-guards.js";
import { reconcileReposBestEffort, startPeriodicReconcile } from "../runtime/reconcile.js";
import { dailySnapshotIfDue } from "../runtime/snapshot.js";
import { createContext } from "../sdk/context.js";
import { bootstrapAuthConfig, readAuthConfig, writeAuthConfig } from "../server/auth.js";
import { resolveBindHost, accessHint, insecureServeReason } from "../server/bind-host.js";
import { startDashboard } from "../server/dashboard.js";
import { preReviewProposal } from "../server/pre-review.js";
import { resolveXcrawlMcpUrl } from "../server/resolve-xcrawl-url.js";
import { resolveIdentity } from "../switchboard/identity.js";
import { PresenceStore } from "../switchboard/presence.js";
import { reapDeadTasks } from "../taskboard/reaper.js";
import { TaskBoard } from "../taskboard/store.js";
import { gateDiscoveredActions } from "../web2mcp/connector-guard.js";
import { cliJsPath, presenceDir, valueAfter } from "./shared.js";
import { registerCliCommand, type CliContext } from "./registry.js";

registerCliCommand({
  name: "board",
  run: async (context: CliContext) => {
    // 跨端看板：把项目进度写成工具无关的 .kunpeng/{BOARD.md, board.json}，任何 agent 读文件即知进度。
    const r = await writeBoard(context.repoRoot);
    if (!r) { console.error("[看板] 生成失败"); process.exit(1); }
    console.log(`[看板] 跨端状态面已生成（工具无关，任何 agent 可读）：`);
    console.log(`  ${join(context.repoRoot, ".kunpeng", "BOARD.md")}`);
    console.log(`  ${join(context.repoRoot, ".kunpeng", "board.json")}`);
    console.log(`  系统 ${r.systemLight} · 活跃流 ${r.activeFlows} · 方案 ${r.plans} · 需人工 ${r.humanGates} · 已过审 ${r.passedLines} 行`);
    return;
  },
});

registerCliCommand({
  name: "task",
  run: async (context: CliContext) => {
    const usage = "用法: kunpeng task <create|claim|claim-next|complete|list|show|reap> [参数]；task reap [--stale-min N]";
    const sub = context.rest[0];
    const taskBoardDir = join(resolveProjectStateDir(context.repoRoot), "taskboard");
    const taskBoard = sub === "complete"
      ? new TaskBoard(taskBoardDir, Date.now, { completedGatesDir: join(taskBoardDir, "gates.d") })
      : new TaskBoard(taskBoardDir);
    try {
      if (sub === "create") {
        const subject = context.rest[1];
        const createdBy = valueAfter(context.rest, "--created-by")
          ?? resolveIdentity({ env: process.env.KUNPENG_INSTANCE, cwd: process.cwd() });
        if (!subject || !createdBy) throw new Error(usage);
        const blockedBy = (valueAfter(context.rest, "--blocked-by") ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        const task = await taskBoard.create({
          subject,
          description: context.descArg ?? valueAfter(context.rest, "--description"),
          blockedBy,
          projectId: valueAfter(context.rest, "--project"),
          createdBy,
        });
        console.log(JSON.stringify(task, null, 2));
        return;
      }
      if (sub === "claim") {
        const id = context.rest[1];
        const owner = valueAfter(context.rest, "--owner") ?? context.rest[2];
        if (!id || !owner || owner.startsWith("--")) throw new Error(usage);
        console.log(JSON.stringify(await taskBoard.claim(id, owner), null, 2));
        return;
      }
      if (sub === "claim-next") {
        const owner = valueAfter(context.rest, "--owner") ?? context.rest[1];
        if (!owner || owner.startsWith("--")) throw new Error(usage);
        console.log(JSON.stringify(await taskBoard.claimNext(owner), null, 2));
        return;
      }
      if (sub === "complete") {
        const id = context.rest[1];
        if (!id) throw new Error(usage);
        console.log(JSON.stringify(await taskBoard.complete(id), null, 2));
        return;
      }
      if (sub === "reap") {
        const hasStaleFlag = context.rest.includes("--stale-min");
        if ((!hasStaleFlag && context.rest.length !== 1) || (hasStaleFlag && (context.rest.length !== 3 || context.rest[1] !== "--stale-min"))) {
          throw new Error(usage);
        }
        const staleMinutesRaw = valueAfter(context.rest, "--stale-min");
        const staleMinutes = staleMinutesRaw === undefined ? 10 : Number(staleMinutesRaw);
        const staleMs = staleMinutes * 60_000;
        if (!Number.isFinite(staleMinutes) || staleMinutes <= 0 || !Number.isSafeInteger(staleMs)) {
          throw new Error(`无效 --stale-min: ${staleMinutesRaw ?? "缺失"}`);
        }
        const released = await reapDeadTasks(taskBoard, new PresenceStore(presenceDir()), Date.now(), staleMs);
        console.log(JSON.stringify(released, null, 2));
        return;
      }
      if (sub === "list") {
        console.log(JSON.stringify(await taskBoard.list(), null, 2));
        return;
      }
      if (sub === "show") {
        const id = context.rest[1];
        if (!id) throw new Error(usage);
        const task = await taskBoard.get(id);
        if (!task) throw new Error(`任务不存在或数据损坏: ${id}`);
        console.log(JSON.stringify(task, null, 2));
        return;
      }
      throw new Error(usage);
    } catch (error) {
      console.error(`[task] ${(error as Error).message}`);
      process.exitCode = 1;
      return;
    }
  },
});

registerCliCommand({
  name: "board-watch",
  run: async (context: CliContext) => {
    // 跨工具聚合：把"和 codex 等聊的项目"加入 watch，总控台读它的 .kunpeng/board.json 显示在同一面。
    const stateDir = kunpengStateDir();
    if (context.flags.has("--list") || context.rest.includes("--list") || !context.rest[0]) {
      const list = await readWatchList(stateDir);
      console.log(`[看板·watch] ${list.length} 个跨工具项目：`);
      for (const p of list) console.log(`  ${p}`);
      if (!list.length) console.log("  （空）用 kunpeng board-watch <项目路径> 加入，让总控台聚合它的 board.json。");
      return;
    }
    const repoPath = resolve(context.rest[0]);
    const list = await addWatch(stateDir, repoPath);
    console.log(`[看板·watch] 已纳入跨工具聚合：${repoPath}`);
    console.log(`  总控台会读它的 .kunpeng/board.json（kunpeng-board/v1）显示进度。现共 ${list.length} 个。`);
    return;
  },
});

registerCliCommand({
  name: "serve",
  run: async (context: CliContext) => {
    installProcessGuards();
    const externalRecipes = await loadExternalRecipes([join(kunpengStateDir(), "recipes")]);
    for (const failure of externalRecipes.failed) {
      console.warn(`[serve] 外置 recipe 加载失败: ${failure.path}: ${failure.error}`);
    }
    if (!process.env.XCRAWL_MCP_URL) {
      const xcrawlUrl = resolveXcrawlMcpUrl(join(homedir(), ".claude.json"));
      if (xcrawlUrl) {
        process.env.XCRAWL_MCP_URL = xcrawlUrl;
        console.log("[serve] 已从 ~/.claude.json 自动注入 XCRAWL_MCP_URL（知识库 URL 捕获走 xcrawl）");
      }
    }
    const port = Number(context.rest[0]) || 7777;
    const hostIdx = context.rest.indexOf("--host");
    const bindHost = resolveBindHost(hostIdx >= 0 ? context.rest[hostIdx + 1] : undefined, process.env.KUNPENG_HOST);
    const stateDir = kunpengStateDir();
    let authCfg = await readAuthConfig(stateDir);
    if (authCfg === null && process.env.KUNPENG_ALLOW_INSECURE !== "1") {
      const bootstrap = bootstrapAuthConfig({
        randomHex: (bytes) => randomBytes(bytes).toString("hex"),
        now: Date.now(),
      });
      await writeAuthConfig(stateDir, bootstrap.config);
      authCfg = bootstrap.config;
      console.log("[serve] 首次启动已自动创建管理员账号");
      console.log(`  用户名: ${bootstrap.config.accounts[0].username}`);
      console.log(`  密码: ${bootstrap.plainPassword}`);
      console.log("  仅此一次，请立即保存");
    }
    const insecure = insecureServeReason(bindHost, authCfg !== null, process.env);
    if (insecure) { console.error(`[serve] 已拒绝启动:${insecure}`); process.exit(1); }
    const execPath = process.execPath;
    const cliJs = cliJsPath();
    const workingDir = resolve(dirname(cliJs), "..");
    await checkDepsSync(workingDir).then((r) => {
      if (r.missing.length) {
        console.error("[依赖守卫] node_modules 缺 " + r.missing.length + " 个声明依赖（" + r.missing.slice(0, 8).join(", ") + "…），请在 orchestrator 跑 npm install，否则 CLI/serve 可能 ERR_MODULE_NOT_FOUND");
      }
    }).catch(() => {});
    // 给了 --repo → 单项目模式（向后兼容）；否则读中央注册表聚合全部项目。
    const single = context.repoArg ?? process.env.KUNPENG_REPO;
    const serveRepos = single
      ? [resolve(single)]
      : (await readRegistry(kunpengStateDir()).catch(() => [])).map((p) => p.repoPath);
    // B3：serve 是崩溃后最常见的重启入口——启动时也清各项目的 dead-process 陈旧锁（活锁因 pid 仍在被自动跳过）。
    // 用 best-effort 助手：registry 里被删/移走的陈旧条目会让 simple-git 构造同步抛，绝不能因此挡住总控台启动（B3-1）。
    await reclaimReposBestEffort(serveRepos);
    await reconcileReposBestEffort(serveRepos);
    const configuredReconcileMs = Number(process.env.KUNPENG_SERVE_RECONCILE_MS);
    startPeriodicReconcile(
      () => reconcileReposBestEffort(serveRepos),
      Number.isFinite(configuredReconcileMs) && configuredReconcileMs > 0 ? configuredReconcileMs : 600_000,
    );
    // #3 BOARD 自动刷新：serve 期间每 10s 给所有项目重写 .kunpeng/{BOARD.md,board.json}，
    // 让 codex/任何工具的 agent 读到的进度始终最新。best-effort，写失败不影响总控台。
    const boardTick = async () => {
      const repos = single
        ? [{ repoPath: resolve(single) }]
        : (await readRegistry(kunpengStateDir()).catch(() => [])).map((p) => ({ repoPath: p.repoPath, id: p.id, name: p.name }));
      for (const r of repos) await writeBoard(r.repoPath, Date.now(), "id" in r && r.id ? { id: r.id as string, name: r.name as string } : undefined).catch(() => {});
    };
    if (single) {
      await startDashboard({ port, host: bindHost, repoRoot: resolve(single), execPath, cliJs, sweepPtyOrphans: true });
      console.log(`[总控台] 单项目 ${resolve(single)} ｜ ${accessHint(bindHost, port)}  (Ctrl-C 退出)`);
      if (bindHost === "0.0.0.0") console.log("[serve] 已对局域网开放——务必已设密码(kunpeng auth set-password),否则同网用户可直接进");
    } else {
      const stateDir = kunpengStateDir();
      const n = (await readRegistry(stateDir)).length;
      await startDashboard({ port, host: bindHost, stateDir, execPath, cliJs, sweepPtyOrphans: true });
      console.log(`[总控台] 多项目（${n} 个，注册表 ${stateDir}）｜ ${accessHint(bindHost, port)}  (Ctrl-C 退出)`);
      if (bindHost === "0.0.0.0") console.log("[serve] 已对局域网开放——务必已设密码(kunpeng auth set-password),否则同网用户可直接进");
    }
    await boardTick(); // 起手先写一次
    setInterval(() => { void boardTick(); }, 10_000).unref?.();
    void dailySnapshotIfDue(kunpengStateDir(), Date.now()).catch(() => {});
    return; // http server 的 open handle 会让进程常驻；必须 return，否则掉到下面的 exit(1) 把服务杀掉
  },
});

registerCliCommand({
  name: "pre-review",
  run: async (context: CliContext) => {
    const { store, runner } = await createContext(context.repoRoot, context.kunpengHome);
    const drafts = (await store.list("proposal")).filter((a) => a.status === "draft");
    console.log(`[pre-review] 待处理 draft 提案 ${drafts.length} 条`);
    let completed = 0;
    for (const a of drafts) {
      const pr = await preReviewProposal(a, runner);
      await store.write({ ...a, meta: { ...(a.meta ?? {}), preReview: pr } });
      completed++;
      console.log(`  ${a.id}: ${pr.verdict} ｜ ${pr.reason}`);
    }
    console.log(`[pre-review] 完成 ${completed}/${drafts.length} 条`);
    return;
  },
});

registerCliCommand({
  name: "web2mcp",
  run: async (context: CliContext) => {
    // 网页转 MCP：发现页面可执行动作(form/network)→生成可独立运行的 MCP server 工程。
    const url = context.rest[0];
    if (!url) { console.error("用法: kunpeng web2mcp <url> [--out <dir>] [--auth <storageState.json>] [--discover form|network|both] [--max-actions N]"); process.exit(1); }
    const outDir = resolve(context.outArg ?? "./web2mcp-out");
    const discover = (context.discoverArg as "form" | "network" | "both") ?? "both";
    const maxActions = context.maxActionsArg ? Math.max(1, Number(context.maxActionsArg)) : undefined;
    try {
      const { runWeb2Mcp } = await import("../web2mcp/run.js");
      const res = await runWeb2Mcp({ url, outDir, discover, storageStatePath: context.authArg, maxActions });
      console.log(`[web2mcp] 发现 ${res.tools} 个动作 → 生成 MCP 工程 ${res.outDir}`);
      console.log(`  下一步：cd ${res.outDir} && npm i && npx tsc；把 server.js 加进你的 MCP 配置（详见 README）。`);
      console.log(`  需登录态的站点：先 kunpeng web2mcp-login ${url} --out auth.json 产 storageState，再 --auth auth.json 重跑。`);
      const store = new ArtifactStore(join(context.repoRoot, ".kunpeng", "artifacts"));
      const guard = await gateDiscoveredActions(store, res.specs, { sensitiveAccess: Boolean(context.authArg) });
      if (guard.gated > 0) {
        console.log(`[web2mcp] ⚠ ${guard.gated}/${guard.total} 个高风险动作已挂「高风险动作放行」人工门（带凭证执行越过 Rule of Two），去 cockpit「待我处理」审定。`);
      }
    } catch (e) {
      console.error(`[web2mcp] 失败：${(e as Error).message}`);
      process.exit(2);
    }
    return;
  },
});

registerCliCommand({
  name: "web2mcp-login",
  run: async (context: CliContext) => {
    // 认证助手：开 headed 浏览器供【用户手动登录】，关闭后存 storageState（不替你登，守铁律）。
    const url = context.rest[0];
    if (!url) { console.error("用法: kunpeng web2mcp-login <url> [--out storageState.json]"); process.exit(1); }
    const outPath = resolve(context.outArg ?? "./storageState.json");
    try {
      const { chromium } = await import("playwright");
      console.log(`[web2mcp-login] 打开浏览器，请在其中手动登录 ${url}，登好后关闭浏览器窗口即可保存会话。`);
      const browser = await chromium.launch({ headless: false });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
      await context.storageState({ path: outPath });
      await browser.close();
      console.log(`[web2mcp-login] 已保存 storageState → ${outPath}（用 kunpeng web2mcp <url> --auth ${outPath}）`);
    } catch (e) {
      console.error(`[web2mcp-login] 失败（需 playwright 且能开图形界面）：${(e as Error).message}`);
      process.exit(2);
    }
    return;
  },
});

registerCliCommand({
  name: "scout",
  run: async (context: CliContext) => {
    // R3：每日为库内项目研究方向 → 写 <repo>/.kunpeng/suggestions.md，下次 onboard 自动注入。
    // 一轮即跑；--install/--uninstall 管 OS 级每日调度（与 patrol 同机制，唯一系统副作用显式触发）。
    const cliPath = cliJsPath();
    const workingDir = resolve(dirname(cliPath), "..");
    const cliJs = join(workingDir, "dist", "cli.js");
    const projectId =
      (await readProjectSelf(context.repoRoot))?.id ??
      (await readRegistry(kunpengStateDir())).find((p) => p.repoPath === context.repoRoot)?.id ?? "default";
    const name =
      (await readProjectSelf(context.repoRoot))?.name ??
      (await readRegistry(kunpengStateDir())).find((p) => p.repoPath === context.repoRoot)?.name ?? projectId;
    const label = `com.kunpeng.scout.${projectId}`;

    if (context.flags.has("--uninstall")) {
      try {
        const r = await uninstallDaemonSchedule(label, daemonPlatform(), realDaemonIo());
        console.log(`[scout] 已卸载每日调度：${r.removed.join(", ")}`);
      } catch (error) {
        console.error(`[scout] 卸载每日调度失败：${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      return;
    }
    if (context.flags.has("--install")) {
      const intervalSeconds = context.intervalArg ? Math.max(60, Number(context.intervalArg)) : 86400;
      const installArgs = [cliJs, "scout", "--repo", context.repoRoot];
      if (context.topicArg) installArgs.push("--topic", context.topicArg);
      const spec = { label, binPath: process.execPath, args: installArgs, intervalSeconds, workingDir };
      try {
        const r = await installDaemonSchedule(spec, daemonPlatform(), realDaemonIo());
        console.log(`[scout] 已安装每日 scout（显式 --install）：`);
        console.log(`  调度文件:  ${r.paths.join(", ")}`);
        console.log(`  间隔:   每 ${intervalSeconds}s 研究并刷新 ${join(context.repoRoot, ".kunpeng", "suggestions.md")}`);
        console.log(`  卸载:   kunpeng scout --repo ${context.repoRoot} --uninstall`);
      } catch (error) {
        console.error(`[scout] 安装每日调度失败：${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      return;
    }

    // 主题：--topic 覆盖；否则从 README/AGENTS 首个非空标题行自动推断研究框架。
    let topic = context.topicArg;
    if (!topic) {
      let desc = "";
      for (const f of ["README.md", "AGENTS.md"]) {
        try {
          const txt = await readFile(join(context.repoRoot, f), "utf8");
          const line = txt.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l.length > 0);
          if (line) { desc = line; break; }
        } catch { /* 无此文件 */ }
      }
      topic = desc
        ? `「${name}（${desc}）」所属领域的最新最佳实践、同类工具进展与可借鉴的升级方向`
        : `「${name}」所属领域的最新最佳实践与可借鉴的升级方向`;
    }

    const researcher = new AgentResearcher(new CliRunner());
    const findings = await researcher.research(topic);
    const generatedAt = new Date().toISOString().slice(0, 10);
    const md = formatSuggestions(name, findings, generatedAt);
    const outPath = join(context.repoRoot, ".kunpeng", "suggestions.md");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, md, "utf8");
    console.log(`[scout] ${name}：研究「${topic}」→ ${findings.length} 条发现 → 写入 ${outPath}（下次 onboard 注入）`);
    await recordAndWarn(context.repoRoot, {
      loop: "scout",
      project: projectId,
      input: 1,
      yield: findings.length,
    });
    return;
  },
});
