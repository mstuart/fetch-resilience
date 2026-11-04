import type { Policy } from "../types.ts";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  halfOpenAfter: number;
  onStateChange?: (state: CircuitState) => void;
  threshold: number;
}

export class CircuitOpenError extends Error {
  constructor() {
    super("Circuit breaker is open");
    this.name = "CircuitOpenError";
  }
}

export function circuitBreaker<T = Response>(
  opts: CircuitBreakerOptions
): Policy<T> {
  const { threshold, halfOpenAfter, onStateChange } = opts;

  if (!Number.isSafeInteger(threshold) || threshold <= 0) {
    throw new TypeError("threshold must be a positive safe integer");
  }
  if (!Number.isFinite(halfOpenAfter) || halfOpenAfter < 0) {
    throw new TypeError("halfOpenAfter must be a non-negative finite number");
  }

  let state: CircuitState = "closed";
  let failureCount = 0;
  let openedAt = 0;

  function setState(newState: CircuitState): void {
    if (newState !== state) {
      state = newState;
      onStateChange?.(newState);
    }
  }

  function startHalfOpenProbe(): void {
    try {
      setState("half-open");
    } catch (error) {
      state = "open";
      throw error;
    }
  }

  return {
    async execute(fn: () => Promise<T>): Promise<T> {
      let isHalfOpenProbe = false;

      if (state === "open") {
        const now = Date.now();
        if (now - openedAt >= halfOpenAfter) {
          startHalfOpenProbe();
          isHalfOpenProbe = true;
        } else {
          throw new CircuitOpenError();
        }
      } else if (state === "half-open") {
        throw new CircuitOpenError();
      }

      let response: T;
      try {
        response = await fn();
      } catch (err) {
        if (isHalfOpenProbe) {
          openedAt = Date.now();
          setState("open");
        } else if (state === "closed") {
          failureCount += 1;
          if (failureCount >= threshold) {
            openedAt = Date.now();
            setState("open");
          }
        }
        throw err;
      }

      if (isHalfOpenProbe) {
        failureCount = 0;
        setState("closed");
      } else if (state === "closed") {
        failureCount = 0;
      }
      return response;
    },
  };
}
