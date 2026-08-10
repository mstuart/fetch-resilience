import type { Policy } from "../types.ts";

export interface TimeoutOptions {
  ms: number;
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function timeout(opts: TimeoutOptions): Policy {
  const { ms } = opts;

  return {
    execute(fn: () => Promise<Response>): Promise<Response> {
      return new Promise<Response>((resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
          reject(new TimeoutError(ms));
        }, ms);

        fn()
          .then((result) => {
            clearTimeout(timer);
            resolve(result);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });
    },
  };
}
