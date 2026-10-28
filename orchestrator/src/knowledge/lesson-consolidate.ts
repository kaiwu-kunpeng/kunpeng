import type { LessonEntry } from "./lesson-store.js";
import { tokenize } from "./tokenize.js";

export interface ConsolidationMerge {
  keep: string;
  drop: string[];
  reason: string;
}

export interface LessonProposal {
  id: string;
  reason: string;
}

export interface ConsolidationPlan {
  merges: ConsolidationMerge[];
  graduateProposals: LessonProposal[];
  retireProposals: LessonProposal[];
}

export interface ConsolidationOptions {
  mergeThreshold?: number;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function lessonTerms(lesson: LessonEntry): Set<string> {
  return new Set(tokenize(`${lesson.title} ${lesson.content}`));
}

export function lessonSimilarity(a: LessonEntry, b: LessonEntry): number {
  if (a.signature !== undefined && b.signature !== undefined && a.signature === b.signature) return 1;

  const left = lessonTerms(a);
  const right = lessonTerms(b);
  if (left.size === 0 && right.size === 0) return 0;

  let intersection = 0;
  for (const term of left) {
    if (right.has(term)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function assertUniqueLessonIds(lessons: readonly LessonEntry[]): Map<string, LessonEntry> {
  const byId = new Map<string, LessonEntry>();
  for (const lesson of lessons) {
    if (byId.has(lesson.id)) throw new Error(`Lesson id 重复: ${lesson.id}`);
    byId.set(lesson.id, lesson);
  }
  return byId;
}

function pickKeep(lessons: readonly LessonEntry[]): LessonEntry {
  return [...lessons].sort((left, right) =>
    right.createdAt - left.createdAt || compareText(left.id, right.id),
  )[0]!;
}

function proposalsFor(lessons: readonly LessonEntry[]): {
  graduateProposals: LessonProposal[];
  retireProposals: LessonProposal[];
} {
  const graduateProposals: LessonProposal[] = [];
  const retireProposals: LessonProposal[] = [];

  for (const lesson of lessons) {
    const { injected, wins, losses } = lesson.stats;
    if (wins >= 3 && losses === 0) {
      graduateProposals.push({
        id: lesson.id,
        reason: `连续验证达到毕业候选条件：wins=${wins}，losses=${losses}；仅提案，不自动毕业`,
      });
    }

    const unused = injected >= 5 && wins === 0;
    const attempts = wins + losses;
    const losing = losses >= 5 && attempts > 0 && wins / attempts < 0.2;
    if (unused || losing) {
      const conditions = [
        ...(unused ? [`injected=${injected} 且 wins=0`] : []),
        ...(losing ? [`losses=${losses} 且胜率=${(wins / attempts).toFixed(3)}<0.2`] : []),
      ];
      retireProposals.push({
        id: lesson.id,
        reason: `达到退役候选条件：${conditions.join("；")}；仅提案，不自动退役`,
      });
    }
  }

  graduateProposals.sort((left, right) => compareText(left.id, right.id));
  retireProposals.sort((left, right) => compareText(left.id, right.id));
  return { graduateProposals, retireProposals };
}

export function planConsolidation(
  lessons: readonly LessonEntry[],
  opts: ConsolidationOptions = {},
): ConsolidationPlan {
  assertUniqueLessonIds(lessons);
  const mergeThreshold = opts.mergeThreshold ?? 0.8;
  if (!Number.isFinite(mergeThreshold) || mergeThreshold < 0 || mergeThreshold > 1) {
    throw new Error(`mergeThreshold 必须在 0..1: ${mergeThreshold}`);
  }

  const parent = lessons.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[index] !== index) {
      const next = parent[index]!;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const unite = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot < rightRoot) parent[rightRoot] = leftRoot;
    else parent[leftRoot] = rightRoot;
  };

  for (let left = 0; left < lessons.length; left += 1) {
    for (let right = left + 1; right < lessons.length; right += 1) {
      if (lessonSimilarity(lessons[left]!, lessons[right]!) >= mergeThreshold) unite(left, right);
    }
  }

  const components = new Map<number, LessonEntry[]>();
  for (let index = 0; index < lessons.length; index += 1) {
    const root = find(index);
    const component = components.get(root);
    if (component) component.push(lessons[index]!);
    else components.set(root, [lessons[index]!]);
  }

  const merges = [...components.values()]
    .filter((component) => component.length > 1)
    .map((component): ConsolidationMerge => {
      const keep = pickKeep(component);
      const drop = component
        .filter((lesson) => lesson.id !== keep.id)
        .map((lesson) => lesson.id)
        .sort(compareText);
      return {
        keep: keep.id,
        drop,
        reason: `合并相似 Lesson：保留最新项 ${keep.id}，移除 ${drop.join(", ")}；被移除项的 sourceIds 将去重并入保留项`,
      };
    })
    .sort((left, right) => compareText(left.keep, right.keep));

  return { merges, ...proposalsFor(lessons) };
}

function cloneLesson(lesson: LessonEntry): LessonEntry {
  return {
    ...lesson,
    sourceIds: [...lesson.sourceIds],
    stats: { ...lesson.stats },
  };
}

export function applyMerges(
  lessons: readonly LessonEntry[],
  merges: readonly ConsolidationMerge[],
): LessonEntry[] {
  const byId = assertUniqueLessonIds(lessons);
  const keepIds = new Set<string>();
  const dropIds = new Set<string>();

  for (const merge of merges) {
    if (!byId.has(merge.keep)) throw new Error(`合并引用未知 keep id: ${merge.keep}`);
    if (keepIds.has(merge.keep)) throw new Error(`合并重复使用 keep id: ${merge.keep}`);
    keepIds.add(merge.keep);

    const localDrops = new Set<string>();
    for (const id of merge.drop) {
      if (!byId.has(id)) throw new Error(`合并引用未知 drop id: ${id}`);
      if (id === merge.keep) throw new Error(`合并不能同时保留并移除同一 id: ${id}`);
      if (localDrops.has(id) || dropIds.has(id)) throw new Error(`合并重复使用 drop id: ${id}`);
      localDrops.add(id);
      dropIds.add(id);
    }
  }

  for (const keep of keepIds) {
    if (dropIds.has(keep)) throw new Error(`Lesson 不能在一个合并计划中既 keep 又 drop: ${keep}`);
  }

  const mergedSources = new Map<string, string[]>();
  for (const merge of merges) {
    const keep = byId.get(merge.keep)!;
    const sourceIds = [...new Set(keep.sourceIds)];
    const seen = new Set(sourceIds);
    for (const dropId of [...merge.drop].sort(compareText)) {
      for (const sourceId of byId.get(dropId)!.sourceIds) {
        if (seen.has(sourceId)) continue;
        seen.add(sourceId);
        sourceIds.push(sourceId);
      }
    }
    mergedSources.set(merge.keep, sourceIds);
  }

  return lessons.flatMap((lesson) => {
    if (dropIds.has(lesson.id)) return [];
    const cloned = cloneLesson(lesson);
    const sourceIds = mergedSources.get(lesson.id);
    return [{ ...cloned, ...(sourceIds === undefined ? {} : { sourceIds }) }];
  });
}
