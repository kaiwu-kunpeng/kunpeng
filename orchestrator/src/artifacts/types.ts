import { z } from "zod";

export const ArtifactKind = z.enum([
  "spec", "plan", "task", "review", "experience",
  "proposal",  // 自我进化提案（待人工门 #2）
  "release",   // 构建发布记录
  "connector", // 高风险 connector 动作（待人工放行）
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const ArtifactStatus = z.enum([
  "draft", "approved", "in-progress", "verified", "rolled-back",
]);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

export const Artifact = z.object({
  kind: ArtifactKind,
  id: z.string().min(1),
  status: ArtifactStatus,
  body: z.string(),
  meta: z.record(z.unknown()).default({}),
});
export type Artifact = z.infer<typeof Artifact>;

export const TRANSITIONS: Record<ArtifactStatus, ArtifactStatus[]> = {
  draft: ["approved", "rolled-back"],
  approved: ["in-progress", "rolled-back"],
  "in-progress": ["verified", "rolled-back"],
  verified: ["rolled-back"],
  "rolled-back": [],
};
