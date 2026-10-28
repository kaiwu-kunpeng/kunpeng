import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentRunner } from "../agent/runner.js";
import type {
  ProductDiscovery,
  ProductValidation,
  ProductValidationDecision,
  ProductValidationSignal,
  ShapedPitch,
} from "./contract.js";
import { productSlug, renderDefineMd, renderDiscoverMd, renderPitchMd, writeProductDoc } from "./artifacts.js";
import { validateOst } from "./ost.js";
import { discoverOst, discoverProduct, shapeProduct, validateProduct } from "./stages.js";
import {
  readInterview,
  readProductDiscovery,
  readShapedPitch,
  writeProductDiscovery,
  writeProductValidation,
  writeShapedPitch,
} from "./store.js";

export async function runProductDiscover(repoRoot: string, runner: AgentRunner): Promise<ProductDiscovery> {
  const session = await readInterview(repoRoot);
  if (!session?.definition) {
    throw new Error('尚无产品定义：请先运行 kunpeng product "<想法>" 生成需求定义');
  }

  const result = await discoverProduct(session.definition, runner);
  await writeProductDiscovery(repoRoot, result);
  // 深接 OST: 产机会-解法树→校验→落 .kunpeng/product/ost-tree.json。失败不挡 discover 主产物。
  try {
    const tree = await discoverOst(result, runner);
    const validation = validateOst(tree);
    const ostPath = join(repoRoot, ".kunpeng", "product", "ost-tree.json");
    await mkdir(dirname(ostPath), { recursive: true });
    await writeFile(ostPath, JSON.stringify({ tree, validation }, null, 2), "utf8");
  } catch {
    /* OST 为 discover 的增强产物,失败不影响主 discovery */
  }
  const slug = productSlug(result.definition.idea);
  await writeProductDoc(repoRoot, slug, "pr-faq.md", renderDefineMd(result.definition));
  await writeProductDoc(repoRoot, slug, "ost.md", renderDiscoverMd(result));
  return result;
}

export async function runProductShape(repoRoot: string, runner: AgentRunner): Promise<ShapedPitch> {
  const discovery = await readProductDiscovery(repoRoot);
  if (!discovery) {
    throw new Error("尚无 DISCOVER 产物：请先运行 kunpeng product discover");
  }

  const pitch = await shapeProduct(discovery, runner);
  await writeShapedPitch(repoRoot, pitch);
  const slug = productSlug(discovery.definition.idea);
  await writeProductDoc(repoRoot, slug, "pitch.md", renderPitchMd(pitch));
  return pitch;
}

export async function runProductValidate(
  repoRoot: string,
  input: {
    hypotheses: string[];
    signals: ProductValidationSignal[];
    decision?: ProductValidationDecision;
    rationale?: string;
  },
): Promise<ProductValidation> {
  const pitch = await readShapedPitch(repoRoot);
  if (!pitch) {
    throw new Error("尚无 SHAPE 产物：请先运行 kunpeng product shape");
  }

  const validation = validateProduct({
    pitch,
    hypotheses: input.hypotheses,
    signals: input.signals,
    decision: input.decision,
    rationale: input.rationale,
  });
  await writeProductValidation(repoRoot, validation);
  return validation;
}
