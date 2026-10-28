export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
    return code !== "ESRCH";
  }
}
