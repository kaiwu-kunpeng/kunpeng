import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** 把模板里的 {{name}} 全替换成项目名（纯函数）。 */
export function renderOnboard(template: string, name: string): string {
  return template.replace(/\{\{name\}\}/g, name);
}

/** 从 KUNPENG_HOME 加载接管声明模板（单一可信源）。 */
export async function loadOnboardTemplate(kunpengHome: string): Promise<string> {
  return readFile(join(kunpengHome, "onboard.tmpl.md"), "utf8");
}
