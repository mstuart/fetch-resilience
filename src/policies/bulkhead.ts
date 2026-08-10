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

export function bulkhead(opts: BulkheadOptions): Policy {
  const { maxConcurrent, maxQueue = Number.POSITIVE_INFINITY } = opts;

  let running = 0;
  const queue: QueueEntry<Response>[] = [];

  function tryRunNext(): void {
    if (queue.length === 0 || running >= maxConcurrent) {
      return;
    }
    const entry = queue.shift();
    if (!entry) {
      return;
    }
    running += 1;
    entry
      .fn()
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
    execute(fn: () => Promise<Response>): Promise<Response> {
      if (running < maxConcurrent) {
        running += 1;
        return fn()
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

      return new Promise<Response>((resolve, reject) => {
        queue.push({ fn, reject, resolve });
      });
    },
  };
}
