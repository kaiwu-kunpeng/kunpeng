#!/usr/bin/env node
// 出包用:按 <dir>/brand-derived.json 从设计预设目录里剔除以品牌命名的预设,重写 index.json,最后删掉清单本身。
// 用法:node strip-brand-presets.mjs <design-systems 目录>
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("用法: strip-brand-presets.mjs <design-systems 目录>");
  process.exit(1);
}
const listPath = join(dir, "brand-derived.json");
if (!existsSync(listPath)) {
  console.error(`找不到 ${listPath},拒绝在不知道剔除范围的情况下出包`);
  process.exit(1);
}

const { ids } = JSON.parse(readFileSync(listPath, "utf8"));
const indexPath = join(dir, "index.json");
const index = JSON.parse(readFileSync(indexPath, "utf8"));
const known = new Set(index.presets.map((p) => p.id));
const unknown = ids.filter((id) => !known.has(id) || !existsSync(join(dir, id)));
if (unknown.length) {
  console.error(`清单里的预设不存在:${unknown.join(", ")}`);
  process.exit(1);
}

const drop = new Set(ids);
for (const id of ids) rmSync(join(dir, id), { recursive: true, force: true });
const presets = index.presets.filter((p) => !drop.has(p.id));
writeFileSync(indexPath, `${JSON.stringify({ ...index, count: presets.length, presets }, null, 2)}\n`);
rmSync(listPath);
console.log(`已剔除 ${ids.length} 个品牌命名预设,保留 ${presets.length} 个`);
