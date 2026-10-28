/** 错误处理小工具：收敛全库重复定义（审计 §1.3）。 */

/** Error 取 message，其它值 String 化。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 带 code 的 Node 系统错误（ENOENT 等）类型守卫。 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** 是否为指定 code 的 Node 系统错误。 */
export function hasErrnoCode(error: unknown, code: string): boolean {
  return isNodeError(error) && error.code === code;
}
