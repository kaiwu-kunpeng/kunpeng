import { z } from "zod";

const ParamTypeSchema = z.enum(["string", "number", "boolean"]);
export type ParamType = z.infer<typeof ParamTypeSchema>;

const ParamLocationSchema = z.enum(["body", "query", "form"]);
export type ParamLocation = z.infer<typeof ParamLocationSchema>;

export const ParamSpecSchema = z.object({
  name: z.string().min(1),
  type: ParamTypeSchema,
  required: z.boolean(),
  in: ParamLocationSchema,
});
export type ParamSpec = z.infer<typeof ParamSpecSchema>;

const ActionKindSchema = z.enum(["form", "network"]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

const ActionTargetSchema = z.object({
  url: z.string().min(1),
  method: z.string().min(1),
});
export type ActionTarget = z.infer<typeof ActionTargetSchema>;

export const ActionSpecSchema = z.object({
  id: z.string().min(1),
  kind: ActionKindSchema,
  title: z.string().min(1),
  target: ActionTargetSchema,
  params: z.array(ParamSpecSchema),
  needsAuth: z.boolean(),
});
export type ActionSpec = z.infer<typeof ActionSpecSchema>;

export interface DiscoverOpts {
  storageStatePath?: string;
  maxActions?: number;
  pageProvider?: PageProvider;
}

export interface ActionDiscoverer {
  discover(url: string, opts?: DiscoverOpts): Promise<ActionSpec[]>;
}

export interface Web2McpResult {
  outDir: string;
  tools: number;
  specs: ActionSpec[];
}

export interface FormField {
  name: string;
  type: string;
  required: boolean;
}

export interface PageForm {
  action: string;
  method: string;
  fields: FormField[];
}

export interface CapturedRequest {
  method: string;
  url: string;
  postData?: string;
  resourceType: string;
}

export interface PageHandle {
  forms(): Promise<PageForm[]>;
  capturedRequests(): Promise<CapturedRequest[]>;
  close(): Promise<void>;
}

export interface PageProvider {
  open(url: string, opts?: { storageStatePath?: string }): Promise<PageHandle>;
}
