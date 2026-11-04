import { bulkhead, circuitBreaker, timeout, wrap } from "../dist/index.js";

const query = wrap(
  () => Promise.resolve([{ id: 1 }]),
  [
    timeout({ ms: 2000 }),
    bulkhead({ maxConcurrent: 2 }),
    circuitBreaker({ halfOpenAfter: 10, threshold: 2 }),
  ]
);
export const result: Promise<{ id: number }[]> = query();
export const nullResult: Promise<null> = timeout<null>({ ms: 10 }).execute(() =>
  Promise.resolve(null)
);
