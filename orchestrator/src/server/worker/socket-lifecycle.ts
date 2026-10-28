import type { WorkerConnection, WorkerConnectionRegistry } from "./worker-connections.js";

export interface WorkerSocketLike {
  on(event: "close" | "error", listener: () => void): void;
}

export interface AttachedWorkerSocket {
  detach(): void;
}

export function attachWorkerSocket({
  registry,
  socket,
  connection,
}: {
  registry: WorkerConnectionRegistry;
  socket: WorkerSocketLike;
  connection: WorkerConnection;
}): AttachedWorkerSocket {
  let detached = false;

  const detach = (): void => {
    if (detached) return;
    detached = true;
    registry.unregister(connection.connId);
  };

  registry.register(connection);
  socket.on("close", detach);
  socket.on("error", detach);

  return { detach };
}
