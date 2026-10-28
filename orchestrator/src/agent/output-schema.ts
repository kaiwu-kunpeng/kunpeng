/** 有 schema 文件路径 → 加 --output-schema <path>;否则空。纯函数。 */
export function outputSchemaArgs(schemaPath: string | undefined): string[] {
  return schemaPath ? ["--output-schema", schemaPath] : [];
}
