"use strict";

const { readFileSync } = require("node:fs");
const path = require("node:path");

function escapeRegexChar(char) {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function globToRegex(glob) {
  let pattern = "";

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];

    if (char === "*" && next === "*") {
      pattern += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }

    pattern += escapeRegexChar(char);
  }

  return new RegExp(`^${pattern}$`);
}

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const writeTools = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
  if (!writeTools.has(payload?.tool_name)) process.exit(0);

  const targetPath = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path;
  if (typeof targetPath !== "string" || targetPath.length === 0) process.exit(0);

  const rawAllow = process.env.KP_SCOPE_ALLOW;
  if (!rawAllow?.trim()) process.exit(0);
  const allow = rawAllow.split(",").map((glob) => glob.trim()).filter(Boolean);
  if (allow.length === 0) process.exit(0);

  const cwd = path.resolve(typeof payload?.cwd === "string" && payload.cwd ? payload.cwd : process.cwd());
  const target = path.resolve(cwd, targetPath);
  const relativePath = path.relative(cwd, target).split(path.sep).join("/");
  const outsideCwd = relativePath === ".." || relativePath.startsWith("../") || path.isAbsolute(relativePath);

  if (!outsideCwd && relativePath.startsWith(".kunpeng/")) process.exit(0);
  if (!outsideCwd && allow.some((glob) => globToRegex(glob).test(relativePath))) process.exit(0);

  process.stderr.write(`[scope-guard] 越界写被拦截: ${relativePath} 不在 allow 范围\n`);
  process.exit(2);
} catch {
  // Hook 自身故障不得卡死开发循环。
  process.exit(0);
}
