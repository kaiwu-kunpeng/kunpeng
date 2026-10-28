import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isValidBackendKind, readBackendPreference, resolveEffectiveKind, writeBackendPreference } from "../agent/backend-preference.js";
import { reportExecutionPosture } from "../agent/execution-posture.js";
import { runGc } from "../git/gc.js";
import { Workspace } from "../git/workspace.js";
import { loadOnboardTemplate, renderOnboard } from "../project/onboard.js";
import { registerProject, readRegistry, readProjectSelf } from "../project/registry.js";
import { kunpengStateDir } from "../project/state-dir.js";
import { runWorkspaceCommand } from "../runtime/workspace-cli.js";
import { pruneSnapshots, snapshotState } from "../runtime/snapshot.js";
import { checkRemoteManifest, compareSemver, downloadUpdate } from "../runtime/update-channel.js";
import { kunpengVersion, versionInfo } from "../runtime/version.js";
import { addAccount, buildAuthConfig, editAccount, readAuthConfig, writeAuthConfig } from "../server/auth.js";
import { registerCliCommand, type CliContext } from "./registry.js";

registerCliCommand({
  name: "workspace",
  run: async (context: CliContext) => {
    const ws = new Workspace(context.repoRoot);
    const r = await runWorkspaceCommand(context.rest, ws);
    if (!r.ok) {
      console.error(`[workspace] ${r.error}`);
      process.exit(1);
    }
    const action = context.rest[0];
    if (action === "acquire") {
      console.log(`[workspace] path: ${r.path}`);
      console.log(`[workspace] branch: ${r.branch}`);
      console.log(`[workspace] identity: ${join(r.path ?? "", ".kunpeng-instance")}`);
    } else if (action === "release" || action === "abandon") {
      console.log(`[workspace] ${action} complete: ${r.id}`);
    }
    return;
  },
});

registerCliCommand({
  name: "register",
  run: async (context: CliContext) => {
    const entry = await registerProject({ repoPath: context.repoRoot, name: context.nameArg, stateDir: kunpengStateDir(), now: Date.now() });
    console.log(`[注册] 已登记项目 ${entry.name}（id=${entry.id}）→ ${entry.repoPath}`);
    console.log(`  中央表: ${join(kunpengStateDir(), "projects.json")} ｜ 自描: ${join(context.repoRoot, ".kunpeng", "project.json")}`);
    return;
  },
});

registerCliCommand({
  name: "projects",
  run: async () => {
    const reg = await readRegistry(kunpengStateDir());
    if (!reg.length) { console.log("（暂无已注册项目）用 kunpeng register --repo <路径> [--name <名>] 登记。"); return; }
    console.log(`[项目] 已注册 ${reg.length} 个：`);
    for (const p of reg) console.log(`  ${p.id} ｜ ${p.name} ｜ ${p.repoPath}`);
    return;
  },
});

registerCliCommand({
  name: "auth",
  run: async (context: CliContext) => {
    const sub = context.rest[0];
    if (sub !== "set-password" && sub !== "add-user") {
      console.error("用法: kunpeng auth set-password [--user <名>] | kunpeng auth add-user <名> [--role owner|member] [--profile <id>]（密码从环境变量 KUNPENG_AUTH_PASSWORD 或 stdin 读，不走命令行参数）");
      process.exitCode = 1;
      return;
    }

    const readPassword = async (): Promise<string> => {
      let password = process.env.KUNPENG_AUTH_PASSWORD ?? "";
      if (!password && !process.stdin.isTTY) {
        password = await new Promise<string>((resolve) => {
          let buf = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => { buf += chunk; });
          process.stdin.on("end", () => resolve(buf.trim()));
        });
      }
      return password;
    };

    const stateDir = kunpengStateDir();
    const existing = await readAuthConfig(stateDir);

    if (sub === "set-password") {
      const userIdx = context.rest.indexOf("--user");
      const usernameArg = userIdx >= 0 ? context.rest[userIdx + 1] : undefined;
      if (userIdx >= 0 && (!usernameArg || usernameArg.startsWith("--"))) {
        console.error("--user 缺少用户名");
        process.exitCode = 1;
        return;
      }
      const username = usernameArg ?? "admin";
      if (existing && !existing.accounts.some((account) => account.username === username)) {
        console.error(`[auth] 用户 ${username} 不存在；请先运行 kunpeng auth add-user ${username}`);
        process.exitCode = 1;
        return;
      }

      const password = await readPassword();
      if (!password) {
        console.error("密码为空:设 KUNPENG_AUTH_PASSWORD 或用管道传入 stdin");
        process.exitCode = 1;
        return;
      }

      const cfg = existing
        ? editAccount(existing, {
            username,
            newPassword: password,
            salt: randomBytes(16).toString("hex"),
            now: Date.now(),
          })
        : buildAuthConfig(username, password, {
            salt: randomBytes(16).toString("hex"),
            secret: randomBytes(32).toString("hex"),
            now: Date.now(),
          });
      await writeAuthConfig(stateDir, cfg);
      console.log(`[auth] 已为用户 ${username} 设置密码 → ${join(stateDir, "auth.json")}（登录会话密钥${existing ? "保留" : "新建"}）`);
      return;
    }

    const username = context.rest[1];
    if (!username || username.startsWith("--")) {
      console.error("用法: kunpeng auth add-user <名> [--role owner|member] [--profile <id>]");
      process.exitCode = 1;
      return;
    }

    const roleIdx = context.rest.indexOf("--role");
    const roleArg = roleIdx >= 0 ? context.rest[roleIdx + 1] : undefined;
    let role: "owner" | "member" = "member";
    if (roleIdx >= 0) {
      if (roleArg !== "owner" && roleArg !== "member") {
        console.error("--role 仅接受 owner 或 member");
        process.exitCode = 1;
        return;
      }
      role = roleArg;
    }

    const profileIdx = context.rest.indexOf("--profile");
    const profileArg = profileIdx >= 0 ? context.rest[profileIdx + 1] : undefined;
    if (profileIdx >= 0 && (!profileArg || profileArg.startsWith("--"))) {
      console.error("--profile 缺少 id");
      process.exitCode = 1;
      return;
    }
    const profileId = profileArg ?? "home";

    if (!existing) {
      console.error("[auth] 尚未初始化；请先运行 kunpeng auth set-password");
      process.exitCode = 1;
      return;
    }

    const password = await readPassword();
    if (!password) {
      console.error("密码为空:设 KUNPENG_AUTH_PASSWORD 或用管道传入 stdin");
      process.exitCode = 1;
      return;
    }

    let cfg: ReturnType<typeof addAccount>;
    try {
      cfg = addAccount(existing, {
        username,
        password,
        profileId,
        role,
        salt: randomBytes(16).toString("hex"),
        now: Date.now(),
      });
    } catch (error) {
      console.error(`[auth] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }
    await writeAuthConfig(stateDir, cfg);
    console.log(`[auth] 已添加用户 ${username}（角色: ${role}）→ ${join(stateDir, "auth.json")}`);
    return;
  },
});

registerCliCommand({
  name: "gc",
  run: async (context: CliContext) => {
    const base = context.rest[0];
    const dryRun = context.flags.has("--dry-run");
    let result;
    try {
      result = await runGc({ repoRoot: context.repoRoot, base, dryRun });
    } catch (e) {
      // base 分支拼错/不存在时 git branch --merged 抛——在删除之前抛，零分支被误删；给友好提示而非裸 stack。
      console.error(`[gc] 无法计算已合并分支（base=${base ?? "当前分支"} 可能不存在或无效）：${String(e)}`);
      process.exit(1);
    }
    console.log(`[gc] base=${result.base} ｜ 分支 ${dryRun ? "将删(dry-run)" : "已删"} ${result.deleted.length} 条 · 保留 ${result.kept.length} 条 ｜ 过期日志 ${dryRun ? "可清" : "已清"} ${result.logsDeleted} 个`);
    for (const branch of result.deleted.slice(0, 20)) console.log(`  ${branch}`);
    if (result.deleted.length > 20) console.log(`  ... 另 ${result.deleted.length - 20} 条`);
    if (dryRun && result.deleted.length) console.log("  去掉 --dry-run 真删。");
    return;
  },
});

registerCliCommand({
  name: "onboard",
  run: async (context: CliContext) => {
    const self = await readProjectSelf(context.repoRoot);
    const reg = await readRegistry(kunpengStateDir());
    const name = self?.name ?? reg.find((p) => p.repoPath === context.repoRoot)?.name;
    if (!name) { console.error(`项目未注册——先跑 kunpeng register --repo ${context.repoRoot}`); process.exit(1); }
    let tmpl: string;
    try { tmpl = await loadOnboardTemplate(context.kunpengHome); }
    catch { console.error(`接管声明模板缺失：${join(context.kunpengHome, "onboard.tmpl.md")}`); process.exit(1); return; }
    console.log(renderOnboard(tmpl, name));
    // R3：若 scout 留过研究建议，附在接管声明后（仅供参考，不自动执行）。
    try {
      const sug = await readFile(join(context.repoRoot, ".kunpeng", "suggestions.md"), "utf8");
      if (sug.trim()) console.log(`\n---\n\n${sug}`);
    } catch { /* 无 scout 建议，跳过 */ }
    return;
  },
});

registerCliCommand({
  name: "backend",
  run: async (context: CliContext) => {
    const arg = context.rest[0];
    if (arg !== undefined) {
      if (!isValidBackendKind(arg)) {
        console.error(`无效后端: ${arg}（可选: local | codex-cloud）`);
        process.exit(1);
      }
      await writeBackendPreference(context.kunpengHome, arg);
      console.log(`已切到: ${arg}`);
      return;
    }
    const pref = await readBackendPreference(context.kunpengHome);
    const kind = resolveEffectiveKind(process.env, pref);
    const posture = reportExecutionPosture({ ...process.env, KUNPENG_EXECUTION_BACKEND: kind });
    console.log(`当前执行后端: ${kind}  | 本地反位: ${posture.offlineCapable ? "成立" : "不成立"}`);
    return;
  },
});

registerCliCommand({
  name: "snapshot",
  run: async () => {
    const stateDir = kunpengStateDir();
    const result = await snapshotState(stateDir, Date.now());
    await pruneSnapshots(join(stateDir, "snapshots"), 7);
    console.log(`[快照] 已保存中央状态：${result.dir}（${result.files} 个文件）`);
    return;
  },
});

registerCliCommand({
  name: "version",
  usage: "用法: kunpeng version",
  run: () => {
    const { version, node, platform } = versionInfo();
    console.log(`鲲鹏 orchestrator v${version}（node ${node} / ${platform}）`);
  },
});

async function configuredUpdateManifestUrl(): Promise<string | undefined> {
  const environmentUrl = process.env.KUNPENG_UPDATE_URL?.trim();
  if (environmentUrl) return environmentUrl;

  try {
    const channelPath = join(kunpengStateDir(), "update-channel.json");
    const parsed: unknown = JSON.parse(await readFile(channelPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("manifestUrl" in parsed)) return undefined;
    const manifestUrl = parsed.manifestUrl;
    return typeof manifestUrl === "string" && manifestUrl.trim() ? manifestUrl.trim() : undefined;
  } catch {
    return undefined;
  }
}

registerCliCommand({
  name: "upgrade",
  usage: "用法: kunpeng upgrade [--download] [--apply]",
  run: async (context: CliContext) => {
    const applyRequested = context.rest.includes("--apply") || context.flags.has("--apply");
    if (applyRequested) {
      console.log("[upgrade] 预留接口，当前不自动执行安装。");
      console.log("git 检出：运行 git pull && npm install，然后重启 kunpeng serve。");
      console.log("tgz 包：解包并替换当前安装后，重启 kunpeng serve。");
      return;
    }

    const manifestUrl = await configuredUpdateManifestUrl();
    if (!manifestUrl) {
      console.log("未配置远程升级通道。");
      console.log("git 检出可运行：git pull && npm install");
      console.log("远程通道可设置 KUNPENG_UPDATE_URL，或写入 ~/.kunpeng/update-channel.json 的 manifestUrl 字段。");
      return;
    }

    const manifest = await checkRemoteManifest(manifestUrl);
    if (!manifest) {
      console.error(`[upgrade] 远程升级通道不可达：${manifestUrl}`);
      process.exitCode = 1;
      return;
    }

    const currentVersion = kunpengVersion();
    const upgradeAvailable = compareSemver(currentVersion, manifest.version) < 0;
    console.log(`当前版本：${currentVersion}`);
    console.log(`最新版本：${manifest.version}`);
    console.log(upgradeAvailable ? "可升级" : "已是最新");
    if (upgradeAvailable && manifest.notes) console.log(`更新说明：${manifest.notes}`);

    const downloadRequested = context.rest.includes("--download") || context.flags.has("--download");
    if (!downloadRequested || !upgradeAvailable) return;
    if (!manifest.url) {
      console.error("[upgrade] 远程清单未提供下载 url。");
      process.exitCode = 1;
      return;
    }

    try {
      const destination = await downloadUpdate(manifest, join(kunpengStateDir(), "updates"));
      console.log(`升级包已下载：${destination}`);
      console.log("请手动解包并替换当前安装，然后重启 kunpeng serve。");
    } catch (error) {
      console.error(`[upgrade] 下载失败：${String(error)}`);
      process.exitCode = 1;
    }
  },
});
