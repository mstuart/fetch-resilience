import type { Policy } from "../types.ts";

const maximumTimeout = 2_147_483_647;

function cancelResponseBody(result: unknown): Promise<unknown> | undefined {
  if (typeof result !== "object" || result === null || !("body" in result)) {
    return;
  }
  const { body } = result;
  if (
    body &&
    typeof body === "object" &&
    "cancel" in body &&
    typeof body.cancel === "function"
  ) {
    return Promise.resolve(body.cancel());
  }
}

export interface TimeoutOptions {
  ms: number;
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function timeout<T = Response>(opts: TimeoutOptions): Policy<T> {
  const { ms } = opts;

  if (!Number.isFinite(ms) || ms < 0) {
    throw new TypeError("ms must be a non-negative finite number");
  }
  if (ms > maximumTimeout) {
    throw new RangeError(`ms must be at most ${maximumTimeout}`);
  }

  return {
    execute(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
          reject(new TimeoutError(ms));
        }, ms);

        Promise.resolve()
          .then(() => fn())
          .then((result) => {
            clearTimeout(timer);
            if (controller.signal.aborted) {
              return cancelResponseBody(result);
            }
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
