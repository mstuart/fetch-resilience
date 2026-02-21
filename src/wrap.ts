import type { Policy } from './types.ts';

export function wrap<T>(
  fn: (...args: any[]) => Promise<T>,
  policies: Policy<T>[],
): (...args: any[]) => Promise<T> {
  return (...args: any[]): Promise<T> => {
    const base = () => fn(...args);
    // Policies applied outer-to-inner: first policy in array is outermost
    // Build chain from right to left so policies[0] wraps everything
    const chain = policies.reduceRight<() => Promise<T>>(
      (next, policy) => () => policy.execute(next),
      base,
    );
    return chain();
  };
}
