import type { Policy } from '../types.ts';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  threshold: number;
  halfOpenAfter: number;
  onStateChange?: (state: CircuitState) => void;
}

export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit breaker is open');
    this.name = 'CircuitOpenError';
  }
}

export function circuitBreaker(opts: CircuitBreakerOptions): Policy {
  const { threshold, halfOpenAfter, onStateChange } = opts;

  let state: CircuitState = 'closed';
  let failureCount = 0;
  let openedAt = 0;

  function setState(newState: CircuitState): void {
    if (newState !== state) {
      state = newState;
      onStateChange?.(newState);
    }
  }

  return {
    async execute(fn: () => Promise<Response>): Promise<Response> {
      if (state === 'open') {
        const now = Date.now();
        if (now - openedAt >= halfOpenAfter) {
          setState('half-open');
        } else {
          throw new CircuitOpenError();
        }
      }

      try {
        const response = await fn();
        if (state === 'half-open') {
          failureCount = 0;
          setState('closed');
        } else {
          failureCount = 0;
        }
        return response;
      } catch (err) {
        failureCount++;
        if (state === 'half-open') {
          openedAt = Date.now();
          setState('open');
        } else if (failureCount >= threshold) {
          openedAt = Date.now();
          setState('open');
        }
        throw err;
      }
    },
  };
}
