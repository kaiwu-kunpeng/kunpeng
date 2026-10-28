#!/usr/bin/env node
// 由 package-lock.json 重新生成 THIRD-PARTY-NOTICES.md 里 npm-deps 标记之间的依赖表。
// 用法(在 orchestrator/ 下):node scripts/gen-third-party-notices.mjs [--lock <path>] [--notices <path>]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BEGIN = "<!-- npm-deps:begin -->";
const END = "<!-- npm-deps:end -->";
const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const lockPath = arg("--lock", join(here, "..", "package-lock.json"));
const noticesPath = arg("--notices", join(here, "..", "THIRD-PARTY-NOTICES.md"));

const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const rows = new Map();
const missing = [];
for (const [key, pkg] of Object.entries(lock.packages ?? {})) {
  if (!key.startsWith("node_modules/") || pkg.dev || pkg.devOptional) continue;
  const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
  if (!pkg.license) missing.push(`${name}@${pkg.version}`);
  rows.set(`${name}@${pkg.version}`, `| ${name} | ${pkg.version} | ${pkg.license} |`);
}
if (missing.length) {
  console.error(`以下生产依赖在 lockfile 里没有 license 字段,请人工核实后再生成:${missing.join(", ")}`);
  process.exit(1);
}

const text = readFileSync(noticesPath, "utf8");
const b = text.indexOf(BEGIN);
const e = text.indexOf(END);
if (b < 0 || e < b) {
  console.error(`${noticesPath} 缺少 ${BEGIN} / ${END} 标记`);
  process.exit(1);
}

const sorted = [...rows.entries()].sort(([a], [c]) => (a < c ? -1 : a > c ? 1 : 0)).map(([, row]) => row);
const table = ["| 组件 | 版本 | 许可证 |", "|---|---|---|", ...sorted].join("\n");
writeFileSync(noticesPath, `${text.slice(0, b + BEGIN.length)}\n${table}\n${text.slice(e)}`);
console.log(`已写入 ${sorted.length} 个生产依赖到 ${noticesPath}`);
