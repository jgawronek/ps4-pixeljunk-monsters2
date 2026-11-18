// src/core/extensions.ts
// Port of Q4.Extensions list helpers used by the sim (RemoveAtSwapBack /
// RemoveSwapBack). Order-preserving removal is intentionally NOT used — the
// original removes in O(1) by swapping the last element into the hole, and
// sim behavior (tick order after purges) depends on those exact semantics.

/** Q4.Extensions.RemoveAtSwapBack — remove index by swapping the last element in. */
export function removeAtSwapBack<T>(list: T[], index: number): void {
  const last = list.length - 1;
  if (index !== last) list[index] = list[last];
  list.pop();
}

/** Q4.Extensions.RemoveSwapBack — removes first occurrence; returns success. */
export function removeSwapBack<T>(list: T[], item: T): boolean {
  const idx = list.indexOf(item);
  if (idx < 0) return false;
  removeAtSwapBack(list, idx);
  return true;
}
