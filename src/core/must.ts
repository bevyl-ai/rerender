/** Narrow `T | undefined` after a check the typechecker cannot see (parsed boxes, range indexes). */
export function must<T>(value: T | null | undefined, message = 'expected a value'): T {
  if (value == null) throw new Error(message);
  return value;
}
