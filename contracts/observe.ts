// The generated runtime observes every invocation; accept only that supported configuration.
import { contract as observe, type ContractSpec } from './runtime.ts';
export function contract<T, A extends unknown[], R>(fn: (this: T, ...args: A) => R,
  spec: ContractSpec<A, R> & { mode: 'observe'; sample: 1; rule: string }): (this: T, ...args: A) => R {
  if (spec.mode !== 'observe' || spec.sample !== 1) throw new Error('Unsupported contract runtime mode');
  return observe(fn, spec);
}
