import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { ProductDefinition, ProductDiscovery, ShapedPitch } from "../src/product/contract.js";
import { validateProduct } from "../src/product/stages.js";
import {
  readProductDiscovery,
  readProductStageArtifact,
  readProductValidation,
  readShapedPitch,
  writeProductDiscovery,
  writeProductStageArtifact,
  writeShapedPitch,
} from "../src/product/store.js";

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-product-stages-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const definition: ProductDefinition = {
  idea: "待办协作",
  problem: "团队任务分散",
  users: ["项目经理"],
  stories: ["作为项目经理，我要看到任务状态"],
  acceptance: ["能创建任务"],
};

const discovery: ProductDiscovery = {
  definition,
  jobStatement: "当项目推进时，项目经理要掌握任务进展",
  targetUsers: ["项目经理"],
  alternatives: ["表格"],
  opportunities: [{ outcome: "减少漏跟进", importance: 9, satisfaction: 3, opportunityScore: 15 }],
  syntheticEvidence: true,
};

const pitch: ShapedPitch = {
  title: "任务进展单页",
  appetite: "2 days",
  problem: "项目经理无法快速看到任务状态",
  solution: "提供任务列表、状态和负责人",
  buildScope: ["创建任务", "标记完成"],
  rabbitHoles: ["复杂权限"],
  noGos: ["即时通讯替代"],
  successMetrics: ["3 分钟内创建首个任务"],
};

test("product-validate blocks pivot or persevere when only synthetic signals are present", () => {
  const validation = validateProduct({
    pitch,
    hypotheses: ["项目经理愿意迁移"],
    signals: [{ source: "synthetic-user", kind: "interview", summary: "模型推演", synthetic: true }],
    decision: "persevere",
    rationale: "synthetic says yes",
  });

  expect(validation.decision).toBe("inconclusive");
  expect(validation.requiresHumanGate).toBe(true);
  expect(validation.rationale).toContain("缺少真实信号");
});

test("product-validate preserves a decision when at least one real signal is present", () => {
  const validation = validateProduct({
    pitch,
    hypotheses: ["项目经理愿意迁移"],
    signals: [{ source: "customer-1", kind: "interview", summary: "愿意试用", synthetic: false }],
    decision: "persevere",
    rationale: "真实客户愿意试用",
  });

  expect(validation.decision).toBe("persevere");
  expect(validation.requiresHumanGate).toBe(true);
  expect(validation.rationale).toBe("真实客户愿意试用");
});

test("product-validate stage artifacts roundtrip through .kunpeng/product files", async () => {
  const repo = await makeRepo();

  await writeProductStageArtifact(repo, "discover", discovery);
  await writeProductStageArtifact(repo, "shape", pitch);

  await expect(readProductStageArtifact(repo, "discover")).resolves.toEqual(discovery);
  await expect(readProductStageArtifact(repo, "shape")).resolves.toEqual(pitch);
  await expect(readProductDiscovery(repo)).resolves.toEqual(discovery);
  await expect(readShapedPitch(repo)).resolves.toEqual(pitch);

  const raw = await readFile(join(repo, ".kunpeng", "product", "discover.json"), "utf8");
  expect(JSON.parse(raw).jobStatement).toBe(discovery.jobStatement);
  await expect(readProductStageArtifact(repo, "validate")).resolves.toBeUndefined();
  await expect(readProductValidation(repo)).resolves.toBeUndefined();
});

test("product-validate specific store helpers write the stable artifact filenames", async () => {
  const repo = await makeRepo();

  await writeProductDiscovery(repo, discovery);
  await writeShapedPitch(repo, pitch);

  await expect(readFile(join(repo, ".kunpeng", "product", "discover.json"), "utf8")).resolves.toContain(
    discovery.jobStatement,
  );
  await expect(readFile(join(repo, ".kunpeng", "product", "shape.json"), "utf8")).resolves.toContain(
    pitch.title,
  );
});
