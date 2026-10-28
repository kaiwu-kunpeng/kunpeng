import { defaultPageProvider } from "./page-provider.js";
import type {
  ActionDiscoverer,
  ActionSpec,
  DiscoverOpts,
  FormField,
  PageForm,
} from "./types.js";

function paramTypeFromField(field: FormField): ActionSpec["params"][number]["type"] {
  const type = field.type.toLowerCase();
  if (["number", "range"].includes(type)) return "number";
  if (["checkbox", "radio"].includes(type)) return "boolean";
  return "string";
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formToAction(form: PageForm, index: number, pageUrl: string): ActionSpec {
  const actionId = slugPart(form.action) || "form";
  return {
    id: `${actionId}-${index + 1}`,
    kind: "form",
    title: `Form ${index + 1}`,
    // target.url = 表单【所在页面】url（绝对），生成的工具导航到此页再提交表单；
    // 不能用 form.action（常是相对路径，Playwright goto 相对路径会抛；且 action 是提交端点非页面）。
    target: { url: pageUrl, method: form.method.toUpperCase() },
    params: form.fields
      .filter((field) => field.name.trim().length > 0)
      .map((field) => ({
        name: field.name,
        type: paramTypeFromField(field),
        required: field.required,
        in: "form",
      })),
    needsAuth: false,
  };
}

export class FormDiscoverer implements ActionDiscoverer {
  async discover(url: string, opts?: DiscoverOpts): Promise<ActionSpec[]> {
    const provider = opts?.pageProvider ?? defaultPageProvider();
    const page = await provider.open(url, { storageStatePath: opts?.storageStatePath });

    try {
      const forms = await page.forms();
      const limit = opts?.maxActions ?? forms.length;
      return forms.slice(0, limit).map((form, i) => formToAction(form, i, url));
    } finally {
      await page.close().catch((error: unknown) => {
        console.warn("表单动作发现页面关闭失败", { url, error });
      });
    }
  }
}
