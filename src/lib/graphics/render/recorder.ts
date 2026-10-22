/** A canvas that only records what is called on it: enough to test order, timing and determinism without a browser. */
export function recorder(): { ctx: import("./context.ts").Canvas2D; log: string[] } {
  const log: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        log.push(`${key}(${args.map((a) => (typeof a === "number" ? Math.round(a * 1000) / 1000 : typeof a === "object" ? "obj" : String(a))).join(",")})`);
        return key === "measureText" ? { width: 10 } : undefined;
      };
    },
    set(target, key: string, value: unknown) {
      log.push(`${key}=${String(value)}`);
      target[key] = value;
      return true;
    },
  }) as unknown as import("./context.ts").Canvas2D;
  return { ctx, log };
}

