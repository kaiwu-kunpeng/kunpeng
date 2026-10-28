const PRODUCT_SLUG_PATTERN = /^[a-z0-9一-龥-]{1,40}$/;

export function isValidProductSlug(slug: unknown): boolean {
  return typeof slug === "string" && PRODUCT_SLUG_PATTERN.test(slug);
}

export function assertProductSlug(slug: unknown): string {
  if (!isValidProductSlug(slug)) {
    throw new Error("非法产品 slug");
  }
  return slug as string;
}
