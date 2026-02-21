import type { Policy } from '../types.ts';

export interface RetryOptions {
  attempts: number;
  backoff?: 'fixed' | 'exponential' | 'linear';
  delayMs?: number;
  jitter?: boolean;
  retryOn?: number[];
  retryOnError?: boolean;
}

const DEFAULT_RETRY_ON = [429, 500, 502, 503, 504];

function computeDelay(
  attempt: number,
  backoff: 'fixed' | 'exponential' | 'linear',
  delayMs: number,
  jitter: boolean,
): number {
  let delay: number;
  switch (backoff) {
    case 'exponential':
      delay = delayMs * Math.pow(2, attempt);
      break;
    case 'linear':
      delay = delayMs * attempt;
      break;
    case 'fixed':
    default:
      delay = delayMs;
      break;
  }
  if (jitter) {
    delay += Math.random() * delayMs;
  }
  return delay;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function retry(opts: RetryOptions): Policy {
  const {
    attempts,
    backoff = 'fixed',
    delayMs = 100,
    jitter = false,
    retryOn = DEFAULT_RETRY_ON,
    retryOnError = true,
  } = opts;

  return {
    async execute(fn: () => Promise<Response>): Promise<Response> {
      let lastError: unknown;
      for (let attempt = 0; attempt <= attempts; attempt++) {
        try {
          const response = await fn();
          if (attempt < attempts && retryOn.includes(response.status)) {
            if (attempt < attempts) {
              const delay = computeDelay(attempt + 1, backoff, delayMs, jitter);
              await sleep(delay);
              continue;
            }
          }
          return response;
        } catch (err) {
          lastError = err;
          if (!retryOnError || attempt === attempts) {
            throw err;
          }
          const delay = computeDelay(attempt + 1, backoff, delayMs, jitter);
          await sleep(delay);
        }
      }
      throw lastError;
    },
  };
}
