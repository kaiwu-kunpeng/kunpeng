import { expect, test } from "vitest";
import type {
  DesignContract,
  DesignSource,
  DesignSourceInput,
  DesignCandidate,
} from "../src/design/contract.js";
import { generateCandidates } from "../src/design/candidates.js";

/** 造一个 stub 来源：resolve 同步返回一份 source 标识为 name 的契约。 */
function stubSource(name: string): DesignSource {
  const contract: DesignContract = {
    source: name,
    anchor: "stub-anchor",
    tokens: { colors: {}, spacing: {}, typography: {} },
    components: [],
  };
  const candidate: DesignCandidate = { source: name, contract };
  return {
    name,
    resolve: async (_in: DesignSourceInput) => candidate,
  };
}

test("generateCandidates 并行解析所有来源，按序包成带 index 的候选", async () => {
  const sources = [stubSource("a"), stubSource("b"), stubSource("c")];
  const input: DesignSourceInput = { kind: "stub" };

  const candidates = await generateCandidates(sources, input);

  expect(candidates).toHaveLength(3);
  expect(candidates.map((cand) => cand.index)).toEqual([0, 1, 2]);
  expect(candidates.map((cand) => cand.contract.source)).toEqual(["a", "b", "c"]);
});
