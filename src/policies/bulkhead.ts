import type { Policy } from '../types.ts';

export interface BulkheadOptions {
  maxConcurrent: number;
  maxQueue?: number;
}

export class BulkheadRejectedError extends Error {
  constructor() {
    super('Bulkhead queue is full');
    this.name = 'BulkheadRejectedError';
  }
}

interface QueueEntry<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function bulkhead(opts: BulkheadOptions): Policy {
  const { maxConcurrent, maxQueue = Infinity } = opts;

  let running = 0;
  const queue: QueueEntry<Response>[] = [];

  function tryRunNext(): void {
    if (queue.length === 0 || running >= maxConcurrent) {
      return;
    }
    const entry = queue.shift()!;
    running++;
    entry
      .fn()
      .then((result) => {
        running--;
        entry.resolve(result);
        tryRunNext();
      })
      .catch((err) => {
        running--;
        entry.reject(err);
        tryRunNext();
      });
  }

  return {
    execute(fn: () => Promise<Response>): Promise<Response> {
      if (running < maxConcurrent) {
        running++;
        return fn()
          .then((result) => {
            running--;
            tryRunNext();
            return result;
          })
          .catch((err) => {
            running--;
            tryRunNext();
            throw err;
          });
      }

      if (queue.length >= maxQueue) {
        return Promise.reject(new BulkheadRejectedError());
      }

      return new Promise<Response>((resolve, reject) => {
        queue.push({ fn, resolve, reject });
      });
    },
  };
}
