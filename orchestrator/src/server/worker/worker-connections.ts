export interface WorkerConnection {
  connId: string;
  accountId: string;
  machineId: string;
  machineName: string;
  root: string;
  connectedAt: number;
}

export interface WorkerConnectionRegistry {
  register(connection: WorkerConnection): void;
  unregister(connId: string): boolean;
  listByAccount(accountId: string): WorkerConnection[];
  findMachine(accountId: string, machineId: string): WorkerConnection | null;
  isMachineOnline(accountId: string, machineId: string): boolean;
  size(): number;
}

export function createWorkerConnectionRegistry(): WorkerConnectionRegistry {
  const connections = new Map<string, WorkerConnection>();

  function findMachine(accountId: string, machineId: string): WorkerConnection | null {
    for (const connection of connections.values()) {
      if (connection.accountId === accountId && connection.machineId === machineId) {
        return connection;
      }
    }
    return null;
  }

  return {
    register(connection): void {
      for (const [connId, current] of connections) {
        const isSameMachine =
          current.accountId === connection.accountId && current.machineId === connection.machineId;
        if (connId === connection.connId || isSameMachine) {
          connections.delete(connId);
        }
      }
      connections.set(connection.connId, connection);
    },

    unregister(connId): boolean {
      return connections.delete(connId);
    },

    listByAccount(accountId): WorkerConnection[] {
      return [...connections.values()].filter((connection) => connection.accountId === accountId);
    },

    findMachine,

    isMachineOnline(accountId, machineId): boolean {
      return findMachine(accountId, machineId) !== null;
    },

    size(): number {
      return connections.size;
    },
  };
}
