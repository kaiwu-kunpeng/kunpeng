import type { PtySessionPoolOpts } from "./pty-pool.js";
import { removePtyEntry, upsertPtyEntry } from "./pty-registry.js";

export function ptyRegistryHooks(registryPath: string): Required<Pick<PtySessionPoolOpts, "onCreated" | "onRemoved">> {
  return {
    onCreated: (info) => {
      void upsertPtyEntry(registryPath, {
        id: info.id,
        workspaceId: info.workspaceId,
        cwd: info.cwd,
        createdAt: info.createdAt,
      }).catch((error: unknown) => console.warn("[pty-registry] 登记失败:", error));
    },
    onRemoved: (id, reason) => {
      if (reason === "detached") return;
      void removePtyEntry(registryPath, id)
        .catch((error: unknown) => console.warn("[pty-registry] 删除登记失败:", error));
    },
  };
}
