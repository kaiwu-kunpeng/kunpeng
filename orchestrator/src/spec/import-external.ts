/** spec 互通导入（U11）：把 GitHub spec-kit 与 OpenSpec 的需求 / 场景 / 任务机械转换成鲲鹏 spec 骨架。
 *  导入件刻意不带 scope 块与 accept 块：验收必须作者亲写，派流前闸（spec-lint 的 scope-missing / accept-missing）
 *  会拦下它，直到作者补齐。只读输入目录，不改源文件。格式核实于 2026-09-24：
 *  - spec-kit：specs/<feature>/spec.md（# Feature Specification: X；### User Story N - T (Priority: Pn)；
 *    Given/When/Then 编号行；- **FR-001**: …；- **SC-001**: …）、plan.md（## Summary）、tasks.md（- [ ] T001 [P] …）
 *  - OpenSpec：openspec/changes/<id>/proposal.md（## Why / ## What Changes）、tasks.md（- [ ] 1.1 …）、
 *    specs/<capability>/spec.md（### Requirement: X / #### Scenario: Y / - **WHEN** … - **THEN** …） */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export type ExternalSpecFormat = "spec-kit" | "openspec";

export interface ImportedParts {
  title: string;
  context: string[];
  requirements: string[];
  scenarios: string[];
  tasks: string[];
}

const FORMAT_LABEL: Record<ExternalSpecFormat, string> = { "spec-kit": "spec-kit", openspec: "OpenSpec" };

/** 去掉 markdown 粗体标记与首尾空白。 */
function plain(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

/** 取 `## <heading>` 之后到下一个同级或更高级标题之前的非空行（跳过 HTML 注释）。 */
function section(md: string, heading: RegExp): string[] {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const out: string[] = [];
  let inComment = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    if (line.includes("<!--")) inComment = true;
    if (!inComment && line.trim() && !/^#/.test(line.trim())) out.push(line.trim());
    if (line.includes("-->")) inComment = false;
  }
  return out;
}

function taskLines(md: string | undefined, pattern: RegExp): string[] {
  if (!md) return [];
  const out: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (match?.[1]) out.push(plain(match[1]));
  }
  return out;
}

export function parseSpecKit(input: { specMd: string; planMd?: string; tasksMd?: string; fallbackTitle: string }): ImportedParts {
  const title = /^#\s+Feature Specification:\s*(.+)$/m.exec(input.specMd)?.[1]?.trim() || input.fallbackTitle;
  const requirements: string[] = [];
  for (const match of input.specMd.matchAll(/^\s*-\s+\*\*((?:FR|SC)-\d+)\*\*:\s*(.+)$/gm)) {
    requirements.push(`${match[1]}：${plain(match[2]!)}`);
  }
  const scenarios: string[] = [];
  let story = "";
  for (const line of input.specMd.split(/\r?\n/)) {
    const storyMatch = /^###\s+User Story\s+(\d+)\s*-\s*(.+?)\s*(?:\(Priority:\s*(P\d+)\))?\s*$/.exec(line);
    if (storyMatch) {
      story = `US${storyMatch[1]}${storyMatch[3] ? `（${storyMatch[3]}）` : ""} ${storyMatch[2]!.trim()}`;
      continue;
    }
    const scenario = /^\s*\d+\.\s+(\*\*Given\*\*.+)$/.exec(line);
    if (scenario && story) scenarios.push(`${story}：${plain(scenario[1]!)}`);
  }
  const summary = input.planMd ? section(input.planMd, /^##\s+Summary\b/) : [];
  return {
    title,
    context: summary.length ? summary : section(input.specMd, /^\*\*Input\*\*/),
    requirements,
    scenarios,
    tasks: taskLines(input.tasksMd, /^\s*-\s+\[[ xX]\]\s+(T\d+.*)$/),
  };
}

export function parseOpenSpec(input: { proposalMd: string; tasksMd?: string; specMds: string[]; changeId: string }): ImportedParts {
  const requirements: string[] = [];
  const scenarios: string[] = [];
  for (const md of input.specMds) {
    const lines = md.split(/\r?\n/);
    let requirement = "";
    let scenario = "";
    let steps: string[] = [];
    const flush = () => {
      if (scenario) scenarios.push(`${scenario}：${steps.join("；")}`);
      scenario = "";
      steps = [];
    };
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const req = /^###\s+Requirement:\s*(.+)$/.exec(line);
      if (req) {
        flush();
        requirement = req[1]!.trim();
        const body = lines.slice(i + 1).find((next) => next.trim() && !next.startsWith("#"));
        requirements.push(body ? `${requirement}：${plain(body)}` : requirement);
        continue;
      }
      const sc = /^####\s+Scenario:\s*(.+)$/.exec(line);
      if (sc) {
        flush();
        scenario = `${requirement ? `${requirement} / ` : ""}${sc[1]!.trim()}`;
        continue;
      }
      const step = /^\s*-\s+\*\*(WHEN|THEN|AND|GIVEN)\*\*\s*(.+)$/.exec(line);
      if (step && scenario) steps.push(`${step[1]} ${plain(step[2]!)}`);
    }
    flush();
  }
  return {
    title: input.changeId,
    context: [...section(input.proposalMd, /^##\s+Why\b/), ...section(input.proposalMd, /^##\s+What Changes\b/)],
    requirements,
    scenarios,
    tasks: taskLines(input.tasksMd, /^\s*-\s+\[[ xX]\]\s+(\d+(?:\.\d+)*\s+.+)$/),
  };
}

function bullets(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- （源文件未提供）";
}

/** 生成鲲鹏 spec 骨架：单 H1、粗体分节、无 scope / accept 块（交给作者补，派流前闸会拦）。 */
export function renderImportedSpec(parts: ImportedParts, format: ExternalSpecFormat, sourcePath: string): string {
  const label = FORMAT_LABEL[format];
  return [
    `# ${parts.title.replace(/^#+\s*/, "")}（导入自 ${label}，待补 scope 与验收）`,
    "",
    "**⚠ 验收必须作者亲写，导入件不可直接派流**：本文件由 `kunpeng spec-import` 机械转换，刻意不带 scope 块与 accept 块，派流前闸会拦下它。请作者据下面的需求与场景补上 scope 块（每行一条 `allow: <文件>`）与作者锁定的 accept-file / accept 块，再派流。",
    "",
    `**来源**：${label} · ${sourcePath}`,
    "",
    "**背景**",
    bullets(parts.context.map(plain)),
    "",
    "**需求**",
    bullets(parts.requirements),
    "",
    "**验收场景（供作者写锁定测试参考）**",
    bullets(parts.scenarios),
    "",
    "**任务**",
    bullets(parts.tasks),
    "",
  ].join("\n");
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** 读外部 spec 目录并转换（只读）。spec-kit 目录须含 spec.md；OpenSpec 变更目录须含 proposal.md。 */
export function importExternalSpec(format: ExternalSpecFormat, dir: string): string {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`输入目录不存在：${dir}`);
  if (format === "spec-kit") {
    const specMd = readIfExists(join(dir, "spec.md"));
    if (specMd === undefined) throw new Error(`spec-kit 目录缺少 spec.md：${dir}`);
    const parts = parseSpecKit({
      specMd, planMd: readIfExists(join(dir, "plan.md")), tasksMd: readIfExists(join(dir, "tasks.md")), fallbackTitle: basename(dir),
    });
    return renderImportedSpec(parts, format, dir);
  }
  const proposalMd = readIfExists(join(dir, "proposal.md"));
  if (proposalMd === undefined) throw new Error(`OpenSpec 变更目录缺少 proposal.md：${dir}`);
  const specsDir = join(dir, "specs");
  const specMds = existsSync(specsDir)
    ? readdirSync(specsDir).sort().map((cap) => join(specsDir, cap, "spec.md")).filter((path) => existsSync(path)).map((path) => readFileSync(path, "utf8"))
    : [];
  const parts = parseOpenSpec({ proposalMd, tasksMd: readIfExists(join(dir, "tasks.md")), specMds, changeId: basename(dir) });
  return renderImportedSpec(parts, format, dir);
}
