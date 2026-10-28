// 品牌 stage:Jung 12 原型 + 四维 tone + pillars + Never-Say。零依赖纯函数。
export interface Archetype {
  id: string;
  name: string;
  trait: string;
  voice: string;
}

export const ARCHETYPES: Archetype[] = [
  { id: "innocent", name: "天真者 Innocent", trait: "乐观、纯粹、信任", voice: "简单、真诚、正向" },
  { id: "sage", name: "智者 Sage", trait: "求真、洞察、权威", voice: "清晰、有据、不卖弄" },
  { id: "explorer", name: "探险家 Explorer", trait: "自由、好奇、突破", voice: "大胆、向外、行动" },
  { id: "rebel", name: "反叛者 Outlaw", trait: "颠覆、打破规则", voice: "锋利、不妥协、敢说" },
  { id: "magician", name: "魔法师 Magician", trait: "转化、愿景、可能", voice: "启发、点石成金感" },
  { id: "hero", name: "英雄 Hero", trait: "勇气、胜任、克难", voice: "笃定、力量、结果导向" },
  { id: "lover", name: "情人 Lover", trait: "亲密、感性、美", voice: "温暖、感官、贴近" },
  { id: "jester", name: "弄臣 Jester", trait: "幽默、当下、轻盈", voice: "俏皮、机智、不端着" },
  { id: "everyman", name: "凡人 Everyman", trait: "归属、务实、平等", voice: "亲切、朴素、接地气" },
  { id: "caregiver", name: "照顾者 Caregiver", trait: "关怀、守护、可靠", voice: "体贴、安心、负责" },
  { id: "ruler", name: "统治者 Ruler", trait: "掌控、秩序、卓越", voice: "权威、精准、有掌控感" },
  { id: "creator", name: "创造者 Creator", trait: "创新、表达、构建", voice: "想象力、精工、原创" },
];

export function getArchetype(id: string): Archetype | undefined {
  const query = id.trim().toLowerCase();
  if (query.length === 0) {
    return undefined;
  }

  return ARCHETYPES.find((archetype) => {
    return archetype.id.toLowerCase() === query || archetype.name.toLowerCase().includes(query);
  });
}

// NN/g 四维 tone 谱:每维 -2..2(负=左,正=右)。
export interface ToneAxes {
  funnySerious: number;
  casualFormal: number;
  irreverentRespectful: number;
  enthusiasticMatter: number;
}

export interface BrandContext {
  name: string;
  archetypeId: string;
  mission: string;
  pillars: string[];
  tone: ToneAxes;
  neverSay: string[];
}

const ZERO_TONE: ToneAxes = {
  funnySerious: 0,
  casualFormal: 0,
  irreverentRespectful: 0,
  enthusiasticMatter: 0,
};

export function buildBrandContext(input: Partial<BrandContext> & { name: string }): BrandContext {
  const archetype = input.archetypeId === undefined ? undefined : getArchetype(input.archetypeId);

  return {
    name: input.name,
    archetypeId: archetype?.id ?? "sage",
    mission: input.mission ?? "",
    pillars: input.pillars ?? [],
    tone: input.tone ?? { ...ZERO_TONE },
    neverSay: input.neverSay ?? [],
  };
}

export function brandContextMd(ctx: BrandContext): string {
  const archetype = getArchetype(ctx.archetypeId) ?? getArchetype("sage")!;
  const pillars = ctx.pillars.length === 0 ? "- (未声明)" : ctx.pillars.map((pillar) => `- ${pillar}`).join("\n");
  const neverSay = ctx.neverSay.length === 0 ? "- (未声明)" : ctx.neverSay.map((word) => `- ${word}`).join("\n");

  return [
    `# ${ctx.name} brand-context`,
    "",
    `品牌名: ${ctx.name}`,
    `原型: ${archetype.name}`,
    `原型 voice: ${archetype.voice}`,
    `使命: ${ctx.mission}`,
    "",
    "品牌支柱:",
    pillars,
    "",
    `Tone: ${toneSummary(ctx.tone)}`,
    "",
    "Never-Say:",
    neverSay,
  ].join("\n");
}

export function brandVoiceDirective(ctx: BrandContext): string {
  const archetype = getArchetype(ctx.archetypeId) ?? getArchetype("sage")!;
  const neverSay = ctx.neverSay.length === 0 ? "无" : ctx.neverSay.join("、");

  return [
    `采用 ${ctx.name} 的品牌声音。`,
    `原型 voice: ${archetype.voice}。`,
    `Tone 倾向: ${toneSummary(ctx.tone)}。`,
    `禁说: ${neverSay}。`,
  ].join("\n");
}

function toneSummary(tone: ToneAxes): string {
  return [
    `funnySerious=${tone.funnySerious}(${axisLabel(tone.funnySerious, "funny", "serious")})`,
    `casualFormal=${tone.casualFormal}(${axisLabel(tone.casualFormal, "casual", "formal")})`,
    `irreverentRespectful=${tone.irreverentRespectful}(${axisLabel(tone.irreverentRespectful, "irreverent", "respectful")})`,
    `enthusiasticMatter=${tone.enthusiasticMatter}(${axisLabel(tone.enthusiasticMatter, "enthusiastic", "matter-of-fact")})`,
  ].join("; ");
}

function axisLabel(value: number, left: string, right: string): string {
  if (value < 0) {
    return left;
  }
  if (value > 0) {
    return right;
  }
  return "balanced";
}
