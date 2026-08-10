export interface Policy<T = Response> {
  execute: (fn: () => Promise<T>) => Promise<T>;
}
