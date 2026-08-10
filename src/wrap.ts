import type { Policy } from "./types.ts";

export function wrap<Arguments extends unknown[], T>(
  fn: (...args: Arguments) => Promise<T>,
  policies: Policy<T>[]
): (...args: Arguments) => Promise<T> {
  return (...args: Arguments): Promise<T> => {
    const base = () => fn(...args);
    // Policies applied outer-to-inner: first policy in array is outermost
    // Build chain from right to left so policies[0] wraps everything
    const chain = policies.reduceRight<() => Promise<T>>(
      (next, policy) => () => policy.execute(next),
      base
    );
    return chain();
  };
}
