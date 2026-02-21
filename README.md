# fetch-resilience

Composable resilience policies for native `fetch` and any async function. Inspired by [Polly](https://github.com/App-vNext/Polly) and [Cockatiel](https://github.com/connor4312/cockatiel), but built from scratch with modern constraints in mind.

- **Zero dependencies** — pure TypeScript, nothing to audit
- **Edge-safe** — runs in Node.js, Bun, Deno, and Cloudflare Workers. No Node.js-specific APIs (`setTimeout` through standard timers, `AbortController` for cancellation)
- **Composable** — stack policies like middleware: `wrap(fetch, [timeout, retry, circuitBreaker])`
- **Type-safe** — full TypeScript with generics, works with any `() => Promise<T>`

## Why not opossum or cockatiel?

| | fetch-resilience | opossum | cockatiel |
|---|---|---|---|
| Zero deps | Yes | No (6+) | No (2+) |
| Edge runtime safe | Yes | No (uses Node EventEmitter) | Partial |
| Composable wrap() | Yes | No (single policy per breaker) | Yes |
| Bundle size | ~2KB | ~15KB | ~8KB |
| Native fetch focus | Yes | Generic | Generic |

## Install

```bash
npm install fetch-resilience
```

## Quick Start

```typescript
import { wrap, retry, timeout, circuitBreaker, bulkhead } from 'fetch-resilience';

const resilientFetch = wrap(fetch, [
  timeout({ ms: 5000 }),
  circuitBreaker({ threshold: 5, halfOpenAfter: 30000 }),
  bulkhead({ maxConcurrent: 10 }),
  retry({ attempts: 3, backoff: 'exponential', delayMs: 200 }),
]);

// Use exactly like fetch
const response = await resilientFetch('https://api.example.com/data');
```

Policies are applied **outer-to-inner**. In the example above, the call flows:
`timeout → circuitBreaker → bulkhead → retry → fetch`

If the retry loop takes longer than 5 seconds total, timeout kills the entire operation.

## API

### `retry(options)`

Retries failed requests with configurable backoff.

```typescript
import { retry } from 'fetch-resilience';

const policy = retry({
  attempts: 3,                          // max retries (not counting initial attempt)
  backoff: 'exponential',               // 'fixed' | 'linear' | 'exponential'
  delayMs: 200,                         // base delay in ms (default: 100)
  jitter: true,                         // add random jitter (default: false)
  retryOn: [429, 500, 502, 503, 504],   // HTTP status codes to retry (defaults shown)
  retryOnError: true,                   // retry on network errors (default: true)
});

const result = await policy.execute(() => fetch('https://api.example.com'));
```

**Backoff strategies:**
- `fixed` — always waits `delayMs`
- `linear` — waits `delayMs * attempt` (100, 200, 300...)
- `exponential` — waits `delayMs * 2^attempt` (200, 400, 800...)
- With `jitter: true`, adds `Math.random() * delayMs` to each delay

### `timeout(options)`

Aborts the operation after a deadline using `AbortController`.

```typescript
import { timeout, TimeoutError } from 'fetch-resilience';

const policy = timeout({ ms: 3000 });

try {
  const result = await policy.execute(() => fetch('https://slow-api.example.com'));
} catch (err) {
  if (err instanceof TimeoutError) {
    console.log('Request timed out');
  }
}
```

### `circuitBreaker(options)`

Implements the circuit breaker pattern with three states:

- **Closed** (normal) — requests flow through. Consecutive failures are counted.
- **Open** — all requests are immediately rejected with `CircuitOpenError`. Entered after `threshold` consecutive failures.
- **Half-open** — after `halfOpenAfter` ms, one probe request is allowed through. Success closes the circuit; failure reopens it.

```typescript
import { circuitBreaker, CircuitOpenError } from 'fetch-resilience';

const policy = circuitBreaker({
  threshold: 5,          // open after 5 consecutive failures
  halfOpenAfter: 30000,  // try again after 30 seconds
  onStateChange: (state) => {
    console.log(`Circuit is now: ${state}`);  // 'closed' | 'open' | 'half-open'
  },
});

try {
  const result = await policy.execute(() => fetch('https://api.example.com'));
} catch (err) {
  if (err instanceof CircuitOpenError) {
    console.log('Circuit is open — not even trying');
  }
}
```

### `bulkhead(options)`

Limits concurrent executions. Excess calls are queued (or rejected if the queue is full).

```typescript
import { bulkhead, BulkheadRejectedError } from 'fetch-resilience';

const policy = bulkhead({
  maxConcurrent: 10,   // max 10 simultaneous executions
  maxQueue: 100,       // max 100 waiting in queue (default: unlimited)
});

try {
  const result = await policy.execute(() => fetch('https://api.example.com'));
} catch (err) {
  if (err instanceof BulkheadRejectedError) {
    console.log('Too many requests queued');
  }
}
```

### `wrap(fn, policies)`

Composes multiple policies around a function. Policies are applied **outer-to-inner** — the first policy in the array is the outermost wrapper.

```typescript
import { wrap, retry, timeout } from 'fetch-resilience';

// timeout wraps retry wraps fetch
const resilientFetch = wrap(fetch, [
  timeout({ ms: 5000 }),
  retry({ attempts: 3, delayMs: 100 }),
]);

const response = await resilientFetch('https://api.example.com/users', {
  method: 'POST',
  body: JSON.stringify({ name: 'Alice' }),
});
```

Works with any async function, not just fetch:

```typescript
async function queryDatabase(sql: string): Promise<Row[]> { /* ... */ }

const resilientQuery = wrap(queryDatabase, [
  timeout({ ms: 2000 }),
  retry({ attempts: 2, delayMs: 500, retryOnError: true }),
]);

const rows = await resilientQuery('SELECT * FROM users');
```

### Using policies directly

Every policy implements the `Policy<T>` interface with a single `execute` method:

```typescript
import { retry } from 'fetch-resilience';
import type { Policy } from 'fetch-resilience';

const policy: Policy<Response> = retry({ attempts: 3 });
const response = await policy.execute(() => fetch('https://example.com'));
```

## Edge Runtime Compatibility

fetch-resilience uses only standard web APIs available across all modern runtimes:

| API Used | Node.js | Bun | Deno | Cloudflare Workers |
|----------|---------|-----|------|--------------------|
| `Promise` | Yes | Yes | Yes | Yes |
| `setTimeout` | Yes | Yes | Yes | Yes |
| `AbortController` | Yes | Yes | Yes | Yes |
| `Math.random` | Yes | Yes | Yes | Yes |
| `Date.now` | Yes | Yes | Yes | Yes |

No `EventEmitter`, no `process`, no `Buffer`, no `fs` — nothing that would break in an edge environment.

## License

MIT
