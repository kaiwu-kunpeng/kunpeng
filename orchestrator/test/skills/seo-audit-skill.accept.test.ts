import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { packSkills } from "../../src/skills/skill-pack.js";
import { scanSkillSafety } from "../../src/skills/skill-safety.js";
import { validateSkillMd } from "../../src/skills/skill-md.js";

const SKILLS = fileURLToPath(new URL("../../../skills/", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const DIR = join(SKILLS, "seo-audit");
const j = (...parts: string[]): string => parts.join("");

// 作者冻结的文件清单（v3.5 快照）：相对路径 → sha256。内容必须与快照逐字节一致，不能多也不能少。
const MANIFEST: Record<string, string> = {
  "SKILL.md": "f8b4ebca0e5ff7117fb5a4f1097c5864250e6baf6a75705fd0c3894351c2238f",
  "assets/annex.css": "5704cbc9f8b26ee9eb2014d7cfd8b2cc7b7840df28a3518a0fe814314b34874d",
  "assets/annex.py": "b297d16c37a10c6171f5f504add6526900ec581127705552101450040b0785bf",
  "assets/audit.example.json": "ec84ae674a76578b7f4d0d7211f5bde7d5d9a21896a0149e07077999348b5bb6",
  "assets/base.css": "fbb569eb07da767176c4d72a8625afa73876f39d55533236e56aae8290e074ee",
  "assets/brief.css": "be84b1a8e117d6b5cb89e0854fdedfb57e2f1ece0b8fa3b29e4fde192fcec893",
  "assets/brief.py": "779990ba51cf7830353aab018594fc310b2b80033db4932bfa67c23e15fd8cc3",
  "assets/charts.py": "8f22eb3e9aaa295274f9f1b54f2ab6bcba6e2859dae78315f1e4d1862d6002eb",
  "assets/claims.py": "9536d888326cc91a0403f4847a028787f456432cf2d039b473d41c37cbef883f",
  "assets/g_core.py": "b65235016e3a9f4c5e6bac1abac87555bbaf989ef17cf756aa54a86419f4f9ac",
  "assets/playbook.css": "eb1cb5beb8d35d7acf65575eeb556c40eb1be89acfe7066da9d44e2178408565",
  "assets/playbook.py": "57eda747f0c7d9b5b03b12b1597342a90e919acb399f715a3d7e82017eb3062d",
  "assets/print.css": "bcbdbdd68876542dbb841273202f0a8d831661a50d6272388273ae64045fb658",
  "assets/report_shell.py": "90b740ccf32b0cd60ab6413b7cbe91c0ed63d4b0ca136ac5da8437461efed3d7",
  "assets/themes.py": "dcd36be358fecabf969d27a8596cb5ea209ace3a17a4ed6db56ceebc985c4025",
  "references/client-language.md": "41e752a2122526a99d21f185e0655e93df18cf473e3c8caf366a94dabb015dea",
  "references/data-collection.md": "8e8eefd6af5fb20bcdc7997f01ace426b596bdba160bfe412d007a3ba43f76f1",
  "references/pitfalls.md": "27852465a9b2c5d6ee84dbbceff7efa99ad3dc96035a5745a202842acf4af441",
  "references/pro-rubric.md": "104f40fa4cbff4fa09e28fa4381069575ba11947be8325903034c37f7bf23127",
  "references/report-structure.md": "7707b4bf9162e1411fceedf72aad1224e42ab81479977ed9f99a7fa6f3280f08",
  "references/review-prompts.md": "36e78ad3c421ae6dd626f22ab2d1e25e090ce0ddce859bf23cec1e8ada3280f6",
  "references/rubric.md": "0b5258bec0d0d1aec80c7cd9d6ae34d07e1678e2cae68146570d4cf4ca1e990a",
  "scripts/_cfg.py": "8a5d185e0d02c0e19bbaaed1cb8ab33cb8878853413bccb3f3fe16824dc89175",
  "scripts/aio_stats.py": "d6a140b77bf78130f9556200f3c3e74e500a0dd16783d748c7f5feb21030c0ce",
  "scripts/analyze.py": "2297899eddd5bfce847968e25ab75f3f2bc8a6d222d1a18d31f528eba5ac6ee0",
  "scripts/competitors.py": "c61d493fae34ad074f9d63ee72120c921fc7ee9ae9e6728b60c480bf6eb60daf",
  "scripts/crawl.py": "0b44104854d5d499c5cdab768c7f34b6ada7f5234ec03fd2af2df1375676f488",
  "scripts/cwv_batch.py": "75a391d94909a6a0336d85b5e2a1b3bc627677a7e01adf058571c004126f56c7",
  "scripts/ext_metrics.py": "18ba9d3edc296a08eeac7ae48d7326fce13d2085a76fc5cd855c0e4b4487dce1",
  "scripts/fidelity_check.py": "e36216e45461b2a826c6d82d837499abf339716f8816c2a79dfc5beb700dd6f8",
  "scripts/geo_probe.py": "fe815adfeb467a36b731c9c21605d31a166fcdde4d526462decf6fe058270919",
  "scripts/http_checks.py": "73b55d9bc54efd76f1d9d9f4ea5ea6c43a2aab2790b4bf42b6bd15bbd4c00312",
  "scripts/kw_collect.py": "4afe10d6c06a77da6cbb4f52ee10a832aa1a832a1f33c5c58d4cf0057dace07e",
  "scripts/number_gate.py": "9aa8e3f94fe14a32b6634cc08d2b419026d7f8e0d217d1dfcad65f95859625e2",
  "scripts/pro_metrics.py": "203aafa32f9c48974442cea6089d2bdd5a2f08280fe1b10b90d8c6f5bc1bdfb6",
  "scripts/scan_report.py": "9c7b1abb3ce620af18abbb98f99a388a2e79a2d97cacc2ae62350cb5d1db68b9",
  "scripts/serp_rank.py": "9f401e51b9d639f95b4839080459c6d3eccd75c2fed40ccc6f94f911a1fe1975",
  "scripts/zh_rules.py": "02276b93e250d32eca9b091e4ee52f9b12957835d769cee04871565565ac674b"
};

function walk(d: string): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "__pycache__" || e.name === ".DS_Store") return [];
    const p = join(d, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe("seo-audit 技能入库（作者锁定）", () => {
  test("文件清单与内容哈希逐一一致，没有多余或缺失的文件", () => {
    expect(existsSync(join(DIR, "SKILL.md"))).toBe(true);
    const files = walk(DIR).map((p) => relative(DIR, p)).sort();
    expect(files).toEqual(Object.keys(MANIFEST).sort());
    for (const [rel, sha] of Object.entries(MANIFEST)) {
      const got = createHash("sha256").update(readFileSync(join(DIR, rel))).digest("hex");
      expect(`${rel} ${got}`).toBe(`${rel} ${sha}`);
    }
  });

  test("SKILL.md 通过标准校验，name 与目录名一致", () => {
    const md = readFileSync(join(DIR, "SKILL.md"), "utf8");
    const v = validateSkillMd(md);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(md).toMatch(/^---\nname: seo-audit\n/);
  });

  test("全部文本文件通过技能安全扫描", () => {
    for (const p of walk(DIR).filter((f) => /\.(md|txt|sh|py|js|ts|json)$/.test(f))) {
      const r = scanSkillSafety(readFileSync(p, "utf8"));
      expect(`${relative(DIR, p)} ${JSON.stringify(r.block)}`).toBe(`${relative(DIR, p)} []`);
    }
  });

  test("仓库打包接收 seo-audit 且没有任何技能被拒", () => {
    const out = mkdtempSync(join(tmpdir(), "kp-seo-audit-pack-"));
    const r = packSkills({ skillsRoot: SKILLS, outDir: out, commit: "t" });
    rmSync(out, { recursive: true, force: true });
    expect(r.rejected).toEqual([]);
    expect(r.packed.map((p) => p.name)).toContain("seo-audit");
  });

  test("不含出包禁用词与个人标识", () => {
    const banned = [j("part", "zeal"), j("traveler", "local"), j("ali", "express"), j("mai", "ka"), j("yu", "guang"), j("予", "光"), j("fli", "ggy"), j("飞", "猪"), j("cass", "time"), j("一号", "车间"), j("迈", "卡"), j("xiao", "peng")];
    for (const p of walk(DIR)) {
      const text = readFileSync(p, "utf8").toLowerCase();
      for (const w of banned) expect(`${relative(DIR, p)}:${text.includes(w.toLowerCase())}`).toBe(`${relative(DIR, p)}:false`);
    }
  });

  test("skills/README.md 的已集成技能里登记了 seo-audit", () => {
    const readme = readFileSync(join(SKILLS, "README.md"), "utf8");
    const line = readme.split("\n").filter((l) => l.startsWith("- [`seo-audit/`](seo-audit/SKILL.md)"));
    expect(line.length).toBe(1);
    expect(line[0]).toContain("诊断与方案两种模式");
    expect(line[0]).not.toContain("只诊断，不给解决方案");
  });

  test("缺 key 时两个脚本给出友好提示并退出码 1，不抛 Python 堆栈", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-audit-nokey-"));
    try {
      mkdirSync(join(tmp, "home"));
      writeFileSync(join(tmp, "audit.json"), JSON.stringify({ origin: "https://example.invalid", locales: { en: { dir: "", lang: "en", gl: "us", hl: "en", google_domain: "google.com" } }, clusters: [], brand: "x" }));
      writeFileSync(join(tmp, "kw-library.json"), JSON.stringify([{ keyword: "x", locale: "en", cluster: "品牌词" }]));
      writeFileSync(join(tmp, "urls.txt"), "https://example.invalid/\n");
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "SERPAPI_KEY" && k !== "GOOGLE_API_KEY") env[k] = v;
      env.HOME = join(tmp, "home");
      const runs: Array<[string, string[], string]> = [
        ["serp_rank.py", ["--config", join(tmp, "audit.json")], "缺 SERPAPI_KEY"],
        ["cwv_batch.py", ["--origin", "https://example.invalid", "--urls", join(tmp, "urls.txt"), "--out", tmp], "缺 GOOGLE_API_KEY"],
      ];
      for (const [script, args, want] of runs) {
        const r = spawnSync("python3", ["-B", join(DIR, "scripts", script), ...args], { cwd: tmp, env, encoding: "utf8", timeout: 30000 });
        expect(`${script} status=${r.status}`).toBe(`${script} status=1`);
        expect(r.stderr).toContain(want);
        expect(r.stderr).not.toContain("Traceback");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test(".gitignore 忽略 Python 缓存目录（在仓库里跑技能脚本不会留下可提交的 pyc）", () => {
    for (const p of ["skills/seo-audit/scripts/__pycache__/serp_rank.cpython-312.pyc", "orchestrator/some/__pycache__/x.pyc"]) {
      const r = spawnSync("git", ["check-ignore", "-q", p], { cwd: REPO, encoding: "utf8" });
      expect(`${p} ignored=${r.status === 0}`).toBe(`${p} ignored=true`);
    }
  });
  const py = (script: string, args: string[], cwd: string) =>
    spawnSync("python3", ["-B", join(DIR, "scripts", script), ...args], { cwd, encoding: "utf8", timeout: 30000 });

  test("ext_metrics：外链按竞品中位数比（奇数个竞品取正中一个），推荐率与来源页覆盖按市场平均", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-ext-"));
    try {
      mkdirSync(join(tmp, "external"));
      writeFileSync(join(tmp, "audit.json"), JSON.stringify({ origin: "https://www.client-site.test", locales: {}, external: { peers: ["peer-a.test", "peer-b.test", "peer-c.test"] } }));
      writeFileSync(join(tmp, "external", "backlinks.csv"), [
        "target;target_type;ascore;backlinks_num;domains_num;follows_num",
        "client-site.test;root_domain;30;1000;100;600",
        "peer-a.test;root_domain;40;2000;200;1000",
        "peer-b.test;root_domain;50;3000;300;2000",
        "peer-c.test;root_domain;60;9000;1000;5000",
      ].join("\n") + "\n");
      writeFileSync(join(tmp, "external", "authority_profile.json"), JSON.stringify({ "0": 10, "2": 50, "5": 20, "25": 20 }));
      writeFileSync(join(tmp, "external", "ai_visibility.json"), JSON.stringify({ pulled: "2026-01-01", markets: {
        de: { visibility: { "client-site.test": 40, "peer-a.test": 50 }, sources: { all: 100, missing: 60 } },
        us: { visibility: { "client-site.test": 20 }, sources: { all: 200, missing: 50 } } } }));
      const r = py("ext_metrics.py", ["--config", join(tmp, "audit.json")], tmp);
      expect(`${r.status} ${r.stderr}`).toBe("0 ");
      const m = JSON.parse(readFileSync(join(tmp, "ext-metrics.json"), "utf8"));
      expect(m.backlinks.median_authority).toBe(50);
      expect(m.backlinks.median_ref_domains).toBe(300);
      expect(m.backlinks.checks).toEqual({ authority_vs_median: 0.6, ref_domains_vs_median: 0.3333 });
      expect(m.backlinks.authority_profile).toMatchObject({ total: 100, low: 60, ge20: 20, low_share: 0.6 });
      expect(m.ai_visibility.checks).toEqual({ recommend_rate: 0.3, source_coverage: 0.575 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("geo_probe：品牌题算准确率并列错误；带账号记忆的推荐不计；判错却没写错误内容直接失败", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-geo-"));
    try {
      mkdirSync(join(tmp, "geo"));
      writeFileSync(join(tmp, "audit.json"), JSON.stringify({ origin: "https://www.client-site.test", locales: {} }));
      writeFileSync(join(tmp, "geo", "questions.json"), JSON.stringify({ version: "v1", markets: { de: { gl: "de", hl: "de", q: { N1: "a", N2: "b", B1: "c", B2: "d" } } } }));
      const rows = [
        { engine: "e1", market: "de", qid: "B1", accurate: true, errors: [] },
        { engine: "e2", market: "de", qid: "B1", accurate: true, errors: [] },
        { engine: "e1", market: "de", qid: "B2", accurate: false, errors: [{ claim: "效率 23.6%", official: "24.3%" }] },
        { engine: "e1", market: "de", qid: "N1", mentioned: true, recommended: true, citations: ["x.test"], memory_biased: true },
        { engine: "e1", market: "de", qid: "N2", mentioned: true, recommended: true, citations: ["x.test"], memory_biased: true },
        { engine: "e2", market: "de", qid: "N1", mentioned: false, recommended: false, citations: ["y.test"], memory_biased: false },
      ];
      writeFileSync(join(tmp, "geo", "answers.jsonl"), rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
      const r = py("geo_probe.py", ["--config", join(tmp, "audit.json")], tmp);
      expect(`${r.status} ${r.stderr}`).toBe("0 ");
      const g = JSON.parse(readFileSync(join(tmp, "geo-probe.json"), "utf8"));
      expect(g.accuracy).toMatchObject({ n: 3, ok: 2, rate: 0.6667, by_engine: { e1: [1, 2], e2: [1, 1] } });
      expect(g.accuracy.errors).toEqual([{ market: "de", qid: "B2", engine: "e1", claim: "效率 23.6%", official: "24.3%" }]);
      expect(g.recommend).toMatchObject({ n_all: 3, n_clean: 1, recommended: 0, rate: 0 });
      writeFileSync(join(tmp, "geo", "answers.jsonl"), JSON.stringify({ engine: "e1", market: "de", qid: "B1", accurate: false, errors: [] }) + "\n");
      const bad = py("geo_probe.py", ["--config", join(tmp, "audit.json")], tmp);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("没写 errors");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("scan_report：诊断模式拦方案词，方案模式放行；工具名、旧出具方名、「前 10」两种模式都拦，「前 100」不拦", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-scan-"));
    try {
      const cfg = (mode: string) => JSON.stringify({ origin: "https://www.client-site.test", locales: {}, issuer: { name: "开悟科技", former_names: ["鹰眼"] }, report: { mode } });
      writeFileSync(join(tmp, "diag.json"), cfg("diagnosis"));
      writeFileSync(join(tmp, "plan.json"), cfg("plan"));
      const page = (body: string) => `<!doctype html><html><body><p>出具：开悟科技</p>${body}<script>const x = "Semrush";</script></body></html>`;
      const cases: Array<[string, string, number]> = [
        ["diag.json", page("<p>官网进入第一页 29 次；未进前 100 名的词 3 个。</p>"), 0],
        ["diag.json", page("<p>附修改单与三个月排期。</p>"), 1],
        ["plan.json", page("<p>附修改单与三个月排期。</p>"), 0],
        ["plan.json", page("<p>官网进入前 10 共 29 次。</p>"), 1],
        ["plan.json", page("<p>外链数据来自 Semrush。</p>"), 1],
        ["plan.json", page("<p>鹰眼 · 诊断报告</p>"), 1],
        ["plan.json", "<html><body><p>没有出具方</p></body></html>", 1],
        ["plan.json", page("<p>见第 {CMPSEC} 节</p>"), 1],
      ];
      cases.forEach(([c, html, want], i) => {
        writeFileSync(join(tmp, `r${i}.html`), html);
        const r = py("scan_report.py", ["--config", join(tmp, c), "--html", join(tmp, `r${i}.html`)], tmp);
        expect(`case ${i} status=${r.status}`).toBe(`case ${i} status=${want}`);
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  const cfgFile = (tmp: string, report: Record<string, unknown>) => {
    const p = join(tmp, `cfg-${Object.keys(report).join("-") || "x"}-${Math.random().toString(36).slice(2, 7)}.json`);
    writeFileSync(p, JSON.stringify({ origin: "https://www.client-site.test", locales: {}, issuer: { name: "开悟科技", former_names: ["鹰眼"] }, report }));
    return p;
  };
  const page = (body: string) => `<!doctype html><html><body><p>出具：开悟科技</p>${body}</body></html>`;

  test("scan_report 中文 AI 腔：设问、强调虚壳、黑话、意义拔高拦下；跨行内标签也能匹配；引用原文与放行词不拦；正式写法通过", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-zh-"));
    try {
      const cfg = cfgFile(tmp, { mode: "plan" });
      const allow = cfgFile(tmp, { mode: "plan", allow_terms: ["闭环"] });
      const cases: Array<[string, string, string, number, string]> = [
        ["clean", cfg, "<p>官网 2,598 个页面中仅 2 页声明 hreflang，13 个语种版本之间缺乏关联。</p><table><tr><td>德国</td><td>0 / 14</td></tr></table>", 0, ""],
        ["ask", cfg, "<p>为什么德国排名偏弱？主要原因是标题未使用本地搜索词。</p>", 1, "Q1"],
        ["inline", cfg, "<p>值得<b>注意</b>的是，官网标题未使用本地搜索词。</p>", 1, "S2"],
        ["jargon", cfg, "<p>通过内容赋能形成增长闭环。</p>", 1, "E6"],
        ["lift", cfg, "<p>多语言配置对官网至关重要。</p>", 1, "E1"],
        ["quoted", cfg, "<p>客户 FAQ 原文为「How long does it last?」，标题写作「打通全链路」。</p>", 0, ""],
        ["allowed", allow, "<p>客户产品线名为闭环控制系列。</p>", 0, ""],
      ];
      for (const [name, c, body, want, rule] of cases) {
        writeFileSync(join(tmp, `${name}.html`), page(body));
        const r = py("scan_report.py", ["--config", c, "--html", join(tmp, `${name}.html`), "--quiet"], tmp);
        expect(`${name} status=${r.status}`).toBe(`${name} status=${want}`);
        if (rule) expect(r.stdout).toContain(`[必须清零] ${rule} `);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("fidelity_check：只改措辞放行；改了数字、域名、表格行数或删掉大段都拒收", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-fid-"));
    try {
      const base = "<h2>结论</h2><p>全站 2,598 个页面中仅 2 页声明 hreflang，德国 0/14，来源 example.de，这一问题影响全部 13 个语种站，官网在多数市场的搜索结果中排名偏后，需要优先处理。</p><table><tr><td>a</td></tr><tr><td>b</td></tr></table>";
      const variants: Array<[string, string, number]> = [
        ["same", base, 0],
        ["reword", base.replace("需要优先处理", "应优先处理"), 0],
        ["number", base.replace("2,598", "2,589"), 1],
        ["domain", base.replace("example.de", "example.nl"), 1],
        ["rows", base.replace("<tr><td>b</td></tr>", ""), 1],
        ["cut", "<h2>结论</h2><p>全站 2,598 个页面中仅 2 页声明 hreflang，德国 0/14，来源 example.de。</p><table><tr><td>a</td></tr><tr><td>b</td></tr></table>", 1],
      ];
      writeFileSync(join(tmp, "before.html"), page(base));
      for (const [name, body, want] of variants) {
        writeFileSync(join(tmp, `${name}.html`), page(body));
        const r = py("fidelity_check.py", ["--before", join(tmp, "before.html"), "--after", join(tmp, `${name}.html`)], tmp);
        expect(`${name} status=${r.status}`).toBe(`${name} status=${want}`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("数字账本与断言：N() 同键异值报错并落盘账本；claim 不符报错；number_gate enforce 拦未登记数字，编号与节号不算", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-ledger-"));
    try {
      const gen = [
        "import sys, json",
        `sys.path.insert(0, ${JSON.stringify(join(DIR, "assets"))})`,
        "import g_core as C, report_shell as S, claims as K",
        "S.start(title='t', site='x.test', brand='开悟科技')",
        "C.begin('full', name='t')",
        "C.p('全站 ' + C.N(2598, 'pages') + ' 页，见 TEC-01，第 01 节。' + K.claim('c1', '德国最高。', K.rank_first({'de': 3, 'it': 1}, 'de')))",
        "C.p(sys.argv[1])",
        "C.end(); S.finish('r.html'); K.dump('claims.json')",
        "out = {'ledger': json.load(open('r.ledger.json'))}",
        "try:\n    C.N(2599, 'pages'); out['conflict'] = False\nexcept ValueError:\n    out['conflict'] = True",
        "try:\n    K.claim('c2', '意大利最高。', K.rank_first({'de': 3, 'it': 1}, 'it')); out['claim'] = False\nexcept AssertionError:\n    out['claim'] = True",
        "print(json.dumps(out))",
      ].join("\n");
      writeFileSync(join(tmp, "gen.py"), gen);
      const g = spawnSync("python3", ["-B", "gen.py", "无其他数字。"], { cwd: tmp, encoding: "utf8", timeout: 30000 });
      expect(`${g.status} ${g.stderr}`).toBe("0 ");
      expect(JSON.parse(g.stdout.trim().split("\n").pop() as string)).toEqual({ ledger: { pages: 2598 }, conflict: true, claim: true });
      const enforce = cfgFile(tmp, { number_gate: "enforce" });
      const ok = py("number_gate.py", ["--config", enforce, "--html", join(tmp, "r.html")], tmp);
      expect(`${ok.status} ${ok.stdout}`).toContain("0 数字 1 个：已登记 1，按值可追溯 0，未登记 0");
      const g2 = spawnSync("python3", ["-B", "gen.py", "另有 37 页手写数字。"], { cwd: tmp, encoding: "utf8", timeout: 30000 });
      expect(g2.status).toBe(0);
      const bad = py("number_gate.py", ["--config", enforce, "--html", join(tmp, "r.html")], tmp);
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain("[未登记] 37");
      const report = py("number_gate.py", ["--config", cfgFile(tmp, {}), "--html", join(tmp, "r.html")], tmp);
      expect(report.status).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("pro_metrics：输出评分表确定性部分（门、结论要点、问号、AI 腔计数）", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-pro-"));
    try {
      const cfg = cfgFile(tmp, { mode: "plan" });
      const lis = Array.from({ length: 5 }, (_, i) => `<li><b>要点 ${i + 1}。</b>影响 ${i + 2} 个市场。</li>`).join("");
      writeFileSync(join(tmp, "r.html"), page(`<h2>结论</h2><ul>${lis}</ul><h2>评分</h2><p>综合 52 分。</p>`));
      const r = py("pro_metrics.py", ["--config", cfg, "--html", join(tmp, "r.html")], tmp);
      expect(`${r.status} ${r.stderr}`).toBe("0 ");
      const m = JSON.parse(readFileSync(join(tmp, "r.metrics.json"), "utf8"));
      expect(m.gates).toMatchObject({ G1_scan: true, G4_structure: true });
      expect(m.D3).toEqual({ conclusion_points: 5, points_bold_with_number: 5, points_in_range: true });
      expect(m.D5).toMatchObject({ ai_must: 0, question_marks: 0 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  const pyc = (code: string, cwd: string) => {
    writeFileSync(join(cwd, "t.py"), [`import sys, json`, `sys.path.insert(0, ${JSON.stringify(join(DIR, "assets"))})`, code].join("\n"));
    return spawnSync("python3", ["-B", "t.py"], { cwd, encoding: "utf8", timeout: 30000 });
  };

  test("主题令牌：base.css 与 charts.py 零色值；四套主题键集一致；强调色注入；未知主题报错", () => {
    const css = readFileSync(join(DIR, "assets", "base.css"), "utf8");
    expect(css.match(/#[0-9A-Fa-f]{3,6}\b|rgba?\(/g)).toBeNull();
    const charts = readFileSync(join(DIR, "assets", "charts.py"), "utf8");
    expect(charts.match(/#[0-9A-Fa-f]{6}\b/g)).toBeNull();
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-theme-"));
    try {
      const r = pyc([
        "import themes as T",
        "keys = {k: sorted(v) for k, v in T.THEMES.items()}",
        "same = all(v == sorted(T.BASE) for v in keys.values())",
        "acc = T.root_css('ink-serif', '#E4002B')",
        "try:\n    T.root_css('nope'); bad = False\nexcept SystemExit:\n    bad = True",
        "print(json.dumps({'n': len(T.THEMES), 'same': same, 'acc': '--ac:#E4002B' in acc and 'color-mix' in acc, 'bad': bad, 'status_same': len({T.THEMES[k]['dg'] for k in T.THEMES}) == 1}))",
      ].join("\n"), tmp);
      expect(`${r.status} ${r.stderr}`).toBe("0 ");
      expect(JSON.parse(r.stdout)).toEqual({ n: 4, same: true, acc: true, bad: true, status_same: true });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("charts：每张图是带 role=img 与标题的 SVG；九宫格列出全部编号且同档不遮挡；子弹图支持组标题", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-charts-"));
    try {
      const r = pyc([
        "import charts as G",
        "figs = [G.bullet([('§SEO', None, None), ('技术', 64, 50)], 't1'), G.hbar([('A', 3), ('B', 5)], 't2', me='B'),",
        "        G.dumbbell([('x', 39, 42.5)], 't3'), G.matrix3x3([('TEC-01', 0, 0), ('TEC-02', 0, 0), ('KW-05', 2, 2)], 't4'),",
        "        G.heatgrid(['de', 'us'], [('r', [0.9, None])], 't5'), G.bubble2x2([('a', .2, .8, 3)], 't6')]",
        "ok = all('<svg' in f and 'role=\"img\"' in f and '<title>' in f for f in figs)",
        "print(json.dumps({'ok': ok, 'ids': all(i in figs[3] for i in ('TEC-01', 'TEC-02', 'KW-05')), 'group': '>SEO<' in figs[0], 'na': '—' in figs[4]}))",
      ].join("\n"), tmp);
      expect(`${r.status} ${r.stderr}`).toBe("0 ");
      expect(JSON.parse(r.stdout)).toEqual({ ok: true, ids: true, group: true, na: true });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("高管摘要版：按契约渲染（版本样式、打印页眉、三项发现、九宫格只在方案模式）；发现不是 3 条或诊断模式带行动即报错", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-brief-"));
    try {
      const base = [
        "import g_core as C, report_shell as S, brief",
        "D = {'title': 'x.test 高管摘要', 'site': 'x.test', 'client': 'X', 'date': '2026-01-01', 'rid': 'SA-1', 'issuer': '开悟科技', 'mode': MODE,",
        "     'scores': {'seo': 53, 'geo': 51, 'composite': 52}, 'summary': {'situation': '现状', 'complication': '问题', 'answer': ['结论一']},",
        "     'findings': [{'title': f'发现{i}', 'value': i, 'unit': '次', 'detail': '依据'} for i in range(NF)],",
        "     'issues': [{'sev': s, 'title': f'问题{s}{i}', 'scope': '2 页', 'impact': '后果', 'evidence': '依据', 'fix': FIX} for i, s in enumerate(['dg', 'dg', 'wa', 'wa'])],",
        "     'dims': [('技术', 64, None)], 'scope': '范围', 'actions': ACTS}",
        "T = {k: k for k in ('summary', 'findings', 'issues', 'scores', 'markets', 'compare', 'uplift', 'improvements', 'actions', 'scope')}",
        "S.start(title=D['title'], site='x.test', brand='开悟科技', theme='ink-serif', edition='brief')",
        "try:\n    brief.render(D, T); S.finish('b.html'); print('rendered')\nexcept SystemExit as e:\n    print('rejected', e)",
      ].join("\n");
      const acts = "[{'id': 'TEC-01', 'name': 'n', 'impact_band': 0, 'effort_band': 0, 'owner': 'o', 'when': 'w'}]";
      const run = (mode: string, nf: number, a: string, fix = "''") => pyc(base.replace("MODE", `'${mode}'`).replace("NF", String(nf)).replace("ACTS", a).replace("FIX", fix), tmp);
      const ok = run("plan", 3, acts);
      expect(`${ok.status} ${ok.stdout.trim()}`).toBe("0 rendered");
      const html = readFileSync(join(tmp, "b.html"), "utf8");
      expect(html).toContain('class="ed-brief"');
      expect(html).toContain("开悟科技 · x.test 高管摘要");
      expect(html).toContain('counter(pages)');
      expect((html.match(/class="fcard[ "]/g) || []).length).toBe(3);
      expect(html).toContain("TEC-01");
      expect(run("plan", 2, acts).stdout).toContain("rejected");
      expect(run("diagnosis", 3, acts).stdout).toContain("rejected");
      expect(run("diagnosis", 3, "[]").stdout.trim()).toBe("rendered");
      expect(run("diagnosis", 3, "[]", "'TEC-03'").stdout).toContain("rejected");
      expect(readFileSync(join(tmp, "b.html"), "utf8")).toContain('class="issue dg"');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("number_gate：图表 SVG 内数值不计；与已登记数字同值算可追溯；报告编号带后缀也放行", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-ng2-"));
    try {
      const cfg = join(tmp, "a.json");
      writeFileSync(cfg, JSON.stringify({ origin: "https://x.test", locales: {}, report: { number_gate: "enforce", rid: "SA-2026-0927-X" } }));
      writeFileSync(join(tmp, "r.html"), page('<p>共 <span data-k="n">29</span> 次，封面再写 29。编号 SA-2026-0927-X-B。</p><svg><text>73</text></svg>'));
      const ok = py("number_gate.py", ["--config", cfg, "--html", join(tmp, "r.html")], tmp);
      expect(`${ok.status} ${ok.stdout}`).toContain("0 数字 2 个：已登记 1，按值可追溯 1，未登记 0");
      writeFileSync(join(tmp, "r2.html"), page('<p>共 <span data-k="n">29</span> 次，另有 31 次。</p>'));
      expect(py("number_gate.py", ["--config", cfg, "--html", join(tmp, "r2.html")], tmp).status).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  const FX = "import sys, json, datetime\nsys.path.insert(0, sys.argv[1])\nimport g_core as C, report_shell as S, annex, playbook\nwhich, mode = sys.argv[2], sys.argv[3]\nif which == \"annex\":\n    D = {\"title\": \"x.test 技术附录\", \"site\": \"x.test\", \"client\": \"X\", \"date\": \"2026-01-01\", \"rid\": \"SA-1\", \"issuer\": \"开悟科技\", \"mode\": mode,\n         \"meta\": [(\"站点\", \"x.test\")],\n         \"issues\": [{\"sev\": \"error\", \"check\": \"hreflang\", \"pages\": \"2 页\", \"evidence\": \"抓取\", \"opp\": \"TEC-03\" if mode == \"plan\" else \"\"}],\n         \"matrix\": {\"cols\": [\"标题\"], \"rows\": [(\"/de/\", [False])], \"note\": \"\"},\n         \"lists\": [{\"id\": \"lang\", \"title\": \"lang 错误页\", \"columns\": [\"URL\"], \"rows\": [[f\"/p{i}?x\"] for i in range(30)], \"note\": \"\"}],\n         \"snippets\": [{\"title\": \"hreflang\", \"code\": \"<link rel=alternate>\", \"note\": \"\"}], \"scope\": \"范围\"}\n    if mode == \"plan\" or len(sys.argv) > 4:\n        D[\"template\"] = [{\"id\": \"TEC-03\", \"what\": \"部署 hreflang\", \"where\": \"模板\", \"how\": \"按内容关联\"}]\n        D[\"rewrites\"] = {\"columns\": [\"URL\", \"现标题\", \"改后\"], \"rows\": [[\"/de/\", \"Solar Panels?\", \"Solarmodule kaufen\"]], \"note\": \"\"}\n    S.start(title=D[\"title\"], site=\"x.test\", brand=\"开悟科技\", theme=\"swiss-mono\", edition=\"annex\")\n    try:\n        annex.render(D); S.finish(\"a.html\"); print(\"rendered\")\n    except SystemExit as e: print(\"rejected\", e)\nelse:\n    P = {\"title\": \"x.test 方案执行\", \"subtitle\": \"s\", \"site\": \"x.test\", \"client\": \"X\", \"date\": \"2026-01-01\", \"rid\": \"SA-1\", \"issuer\": \"开悟科技\", \"mode\": mode,\n         \"start\": datetime.date(2026, 1, 5), \"weeks\": 4, \"scores\": {\"seo\": (53, 83), \"geo\": (51, 62), \"composite\": (52, 75)},\n         \"lead\": \"导语\", \"kpis\": [(\"行动\", \"2\", \"项\", \"in\")], \"targets\": [(\"技术\", 64, 95)], \"lanes\": [(\"开发\", \"series-1\")],\n         \"tasks\": [{\"id\": \"TEC-01\", \"name\": \"改 canonical\", \"lane\": \"开发\", \"weeks\": [1], \"owner\": \"开发\", \"parties\": [\"dev\"], \"days\": 0.5, \"work\": \"改\", \"accept\": \"验\", \"prio\": \"高\"},\n                   {\"id\": \"TEC-02\", \"name\": \"改 lang\", \"lane\": \"开发\", \"weeks\": [2, 3], \"owner\": \"开发\", \"parties\": [\"dev\"], \"days\": 1, \"work\": \"改\", \"accept\": \"验\", \"prio\": \"中\"}],\n         \"checkpoints\": [{\"name\": \"验收\", \"weeks\": [4], \"what\": \"复测\"}], \"months\": [{\"name\": \"第 1 月\", \"lo\": 1, \"hi\": 4, \"goal\": \"目标\"}],\n         \"parties\": [(\"开发\", \"dev\")], \"gates\": [{\"name\": \"M1\", \"week\": 4, \"scope\": \"全部\", \"criteria\": \"通过\"}], \"tracking\": None,\n         \"confirm\": [(\"权限\", \"需要\", \"DAT-01\")], \"risks\": [(\"风险\", \"应对\")], \"scope\": \"范围\"}\n    T = {k: k for k in (\"overview\", \"targets\", \"roadmap\", \"months\", \"raci\", \"gates\", \"tracking\", \"confirm\", \"risks\", \"scope\")}\n    S.start(title=P[\"title\"], site=\"x.test\", brand=\"开悟科技\", theme=\"teal-playbook\", edition=\"playbook\")\n    try:\n        playbook.render(P, T); S.finish(\"p.html\"); print(\"rendered\")\n    except SystemExit as e: print(\"rejected\", e)\n";
  const fx = (which: string, mode: string, extra = "") => {
    const tmp = mkdtempSync(join(tmpdir(), `kp-seo-${which}-`));
    writeFileSync(join(tmp, "fx.py"), FX);
    const r = spawnSync("python3", ["-B", "fx.py", join(DIR, "assets"), which, mode, ...(extra ? [extra] : [])], { cwd: tmp, encoding: "utf8", timeout: 30000 });
    const file = join(tmp, which === "annex" ? "a.html" : "p.html");
    const html = existsSync(file) ? readFileSync(file, "utf8") : "";
    rmSync(tmp, { recursive: true, force: true });
    return { out: r.stdout.trim(), err: r.stderr, html };
  };

  test("技术附录版：表体服务端写入（长清单只写第一页、全量在 JSON），数据表带 data-quote；诊断模式带改写稿即报错", () => {
    const p = fx("annex", "plan");
    expect(`${p.out} ${p.err}`).toBe("rendered ");
    expect(p.html).toContain('class="ed-annex"');
    expect(p.html).toContain("<td>/p0?x</td>");
    expect(p.html).not.toContain("<td>/p29?x</td>");
    expect(p.html).toContain('"/p29?x"');
    expect(p.html).toContain("<td>Solarmodule kaufen</td>");
    expect(p.html).toMatch(/<table data-quote class="dt-table/);
    expect(fx("annex", "diagnosis").out).toBe("rendered");
    expect(fx("annex", "diagnosis", "withrw").out).toContain("rejected");
  });

  test("方案执行版：只在方案模式渲染，甘特为 SVG；诊断模式报错", () => {
    const p = fx("playbook", "plan");
    expect(`${p.out} ${p.err}`).toBe("rendered ");
    expect(p.html).toContain('class="ed-playbook"');
    expect(p.html).toContain("<svg");
    expect(p.html).toContain("TEC-02");
    expect(fx("playbook", "diagnosis").out).toContain("rejected");
  });

  test("原始数据表与目录：data-quote 表里的客户原文不判 AI 腔；节标题含 N() 时目录只放纯文本", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-quote-"));
    try {
      const cfg = cfgFile(tmp, { mode: "plan" });
      writeFileSync(join(tmp, "q1.html"), page('<table data-quote><tr><td>Why choose us? Best panels!</td><td>了解更多详情！</td></tr></table>'));
      expect(py("scan_report.py", ["--config", cfg, "--html", join(tmp, "q1.html"), "--quiet"], tmp).status).toBe(0);
      writeFileSync(join(tmp, "q2.html"), page("<p>了解更多详情！</p>"));
      expect(py("scan_report.py", ["--config", cfg, "--html", join(tmp, "q2.html"), "--quiet"], tmp).status).toBe(1);
      const r = pyc(["import g_core as C, report_shell as S", "S.start(title='t', site='x.test')", "C.begin('full', name='t')",
        "C.h2(C.N(7, 'k7') + ' 个问题')", "C.end(); S.finish('r.html')"].join("\n"), tmp);
      expect(`${r.status} ${r.stderr}`).toBe("0 ");
      const sidenav = (readFileSync(join(tmp, "r.html"), "utf8").match(/SIDENAV\["full"\]=(\[.*?\]);/) || [])[1] || "";
      expect(sidenav).toContain("7 个问题");
      expect(sidenav).not.toContain("data-k");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  test("默认交付组合：SKILL.md 写明三类客户的版本组合，配置模板带 editions", () => {
    const md = readFileSync(join(DIR, "SKILL.md"), "utf8");
    expect(md).toContain("## 交付组合");
    expect(md).toMatch(/诊断客户.*高管摘要版 \+ 完整诊断版/);
    expect(md).toMatch(/方案客户.*方案执行版/);
    expect(md).toMatch(/有技术对接.*技术附录版/);
    const cfg = JSON.parse(readFileSync(join(DIR, "assets", "audit.example.json"), "utf8"));
    expect(cfg.report.editions).toEqual(["brief", "audit"]);
  });
  test("完整诊断版默认与已交付版一致：不带打印页眉页码与打印脚本，经典字体顺序；print_pages=True 时才加；其他版本默认加", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-seo-classic-"));
    try {
      const gen = (args: string, out: string) => pyc(["import g_core as C, report_shell as S", `S.start(title='t', site='x.test'${args})`,
        "C.begin('full', name='t')", "C.h2('结论')", `C.end(); S.finish('${out}')`].join("\n"), tmp);
      for (const [args, out] of [["", "a.html"], [", print_pages=True", "b.html"], [", edition='brief', theme='ink-serif'", "c.html"]]) {
        const r = gen(args, out);
        expect(`${out} ${r.status} ${r.stderr}`).toBe(`${out} 0 `);
      }
      const a = readFileSync(join(tmp, "a.html"), "utf8");
      expect(a).not.toContain("counter(pages)");
      expect(a).not.toContain("beforeprint");
      expect(a).toContain('--font-sans:"Inter","Segoe UI"');
      const b = readFileSync(join(tmp, "b.html"), "utf8");
      expect(b).toContain("counter(pages)");
      expect(b).toContain("beforeprint");
      expect(readFileSync(join(tmp, "c.html"), "utf8")).toContain("counter(pages)");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});