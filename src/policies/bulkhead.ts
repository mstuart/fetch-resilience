import type { Policy } from "../types.ts";

export interface BulkheadOptions {
  maxConcurrent: number;
  maxQueue?: number;
}

export class BulkheadRejectedError extends Error {
  constructor() {
    super("Bulkhead queue is full");
    this.name = "BulkheadRejectedError";
  }
}

interface QueueEntry<T> {
  fn: () => Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
}

export function bulkhead<T = Response>(opts: BulkheadOptions): Policy<T> {
  const { maxConcurrent, maxQueue = Number.POSITIVE_INFINITY } = opts;

  if (!Number.isInteger(maxConcurrent) || maxConcurrent <= 0) {
    throw new TypeError("maxConcurrent must be a positive integer");
  }

  if (
    maxQueue !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(maxQueue) || maxQueue < 0)
  ) {
    throw new TypeError("maxQueue must be a non-negative integer or Infinity");
  }

  let running = 0;
  const queue: QueueEntry<T>[] = [];

  function tryRunNext(): void {
    if (queue.length === 0 || running >= maxConcurrent) {
      return;
    }
    const entry = queue.shift();
    if (!entry) {
      return;
    }
    running += 1;
    Promise.resolve()
      .then(() => entry.fn())
      .then((result) => {
        running -= 1;
        entry.resolve(result);
        tryRunNext();
      })
      .catch((err) => {
        running -= 1;
        entry.reject(err);
        tryRunNext();
      });
  }

  return {
    execute(fn: () => Promise<T>): Promise<T> {
      if (running < maxConcurrent) {
        running += 1;
        return Promise.resolve()
          .then(() => fn())
          .then((result) => {
            running -= 1;
            tryRunNext();
            return result;
          })
          .catch((err) => {
            running -= 1;
            tryRunNext();
            throw err;
          });
      }

      if (queue.length >= maxQueue) {
        return Promise.reject(new BulkheadRejectedError());
      }

      return new Promise<T>((resolve, reject) => {
        queue.push({ fn, reject, resolve });
      });
    },
  };
}
