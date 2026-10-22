/** How many graphics are drawn at the same time: half of the processor cores, from 1 to 4 (each one uses a worker and an FFmpeg). */
export function poolSize(cores: number): number {
  return Math.min(4, Math.max(1, Math.floor((Number.isFinite(cores) ? cores : 2) / 2)));
}

/**
 * Runs `work` on every item with at most `limit` at once. Results keep the order of the items.
 * After the first failure nothing new is started; the ones already running finish, then the first error is thrown.
 */
export async function runPool<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;
  const lane = async () => {
    while (failure === null && next < items.length) {
      const index = next++;
      try {
        results[index] = await work(items[index] as T, index);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  if (failure !== null) throw (failure as { error: unknown }).error;
  return results;
}
