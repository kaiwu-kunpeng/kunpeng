import type { WorkerEndpoint } from "./worker-endpoint.js";

let workerEndpoint: WorkerEndpoint | null = null;

export function setWorkerEndpoint(endpoint: WorkerEndpoint | null): void {
  workerEndpoint = endpoint;
}

export function getWorkerEndpoint(): WorkerEndpoint | null {
  return workerEndpoint;
}
