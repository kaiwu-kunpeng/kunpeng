export interface CacheEntry<T> {
  at: number;
  value: T;
}

const inflightByStore = new WeakMap<object, Map<string, Promise<unknown>>>();

export async function cachedAsync<T>(
  store: Map<string, CacheEntry<T>>,
  key: string,
  ttlMs: number,
  now: number,
  produce: () => Promise<T>,
): Promise<T> {
  const entry = store.get(key);
  if (entry !== undefined && ttlMs > 0 && now - entry.at < ttlMs) {
    return entry.value;
  }

  let inflight = inflightByStore.get(store);
  const existing = inflight?.get(key);
  if (existing !== undefined) {
    return existing as Promise<T>;
  }

  if (inflight === undefined) {
    inflight = new Map<string, Promise<unknown>>();
    inflightByStore.set(store, inflight);
  }
  const flights = inflight;

  const flight = Promise.resolve()
    .then(produce)
    .then((value) => {
      store.set(key, { at: now, value });
      return value;
    })
    .finally(() => {
      if (flights.get(key) === flight) {
        flights.delete(key);
      }
      if (flights.size === 0) {
        inflightByStore.delete(store);
      }
    });

  flights.set(key, flight);
  return flight;
}
