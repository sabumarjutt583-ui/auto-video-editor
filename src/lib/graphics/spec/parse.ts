/**
 * A tiny schema library (no dependencies). A parser reads an unknown value and returns the clean value or FAIL.
 * Two modes: strict (every problem is an error, nothing is changed) and repair (numbers are clamped, text is cut,
 * unknown fields are dropped, what cannot be repaired is dropped or fails). The output types are inferred.
 */
import type { Catalog } from "./catalog.ts";

export const FAIL: unique symbol = Symbol("fail");
export type Fail = typeof FAIL;

export interface Issue {
  path: string;
  message: string;
  /** True when repair mode fixed it (or dropped it). In strict mode nothing is repaired. */
  repaired: boolean;
}

export interface Ctx {
  repair: boolean;
  issues: Issue[];
  catalog: Catalog;
}

export type Parser<T> = (value: unknown, path: string, ctx: Ctx) => T | Fail;
export type Infer<P> = P extends Parser<infer T> ? T : never;

export function fail(ctx: Ctx, path: string, message: string): Fail {
  ctx.issues.push({ path, message, repaired: false });
  return FAIL;
}

export function note(ctx: Ctx, path: string, message: string): void {
  ctx.issues.push({ path, message, repaired: true });
}

const missing = (value: unknown): boolean => value === undefined || value === null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function join(path: string, key: string | number): string {
  return typeof key === "number" ? `${path}[${key}]` : path === "" ? key : `${path}.${key}`;
}

interface NumOptions {
  min: number;
  max: number;
  int?: boolean;
  def?: number;
}

export function num(o: NumOptions): Parser<number> {
  return (value, path, ctx) => {
    if (missing(value)) return o.def !== undefined ? o.def : fail(ctx, path, "is required");
    if (typeof value !== "number" || !Number.isFinite(value)) {
      if (ctx.repair && o.def !== undefined) {
        note(ctx, path, `was not a number, ${o.def} is used`);
        return o.def;
      }
      return fail(ctx, path, "must be a number");
    }
    let result = value;
    if (o.int === true && !Number.isInteger(result)) {
      if (!ctx.repair) return fail(ctx, path, "must be a whole number");
      result = Math.round(result);
      note(ctx, path, "was rounded to a whole number");
    }
    if (result < o.min || result > o.max) {
      if (!ctx.repair) return fail(ctx, path, `must be between ${o.min} and ${o.max}`);
      result = Math.min(o.max, Math.max(o.min, result));
      note(ctx, path, `was outside ${o.min} to ${o.max} and was clamped to ${result}`);
    }
    return result;
  };
}

interface StrOptions {
  min?: number;
  max: number;
  def?: string;
  pattern?: RegExp;
  /** Message for a pattern mismatch. */
  expects?: string;
}

const CONTROL = /[\u0000-\u001f\u007f]/g;
const HAS_CONTROL = /[\u0000-\u001f\u007f]/;

export function str(o: StrOptions): Parser<string> {
  const min = o.min ?? 0;
  return (value, path, ctx) => {
    if (missing(value)) return o.def !== undefined ? o.def : fail(ctx, path, "is required");
    if (typeof value !== "string") {
      if (ctx.repair && o.def !== undefined) {
        note(ctx, path, "was not text, the default is used");
        return o.def;
      }
      return fail(ctx, path, "must be text");
    }
    let text = value;
    if (HAS_CONTROL.test(text)) {
      if (!ctx.repair) return fail(ctx, path, "contains control characters or line breaks");
      text = text.replace(CONTROL, " ");
      note(ctx, path, "had control characters or line breaks, they were replaced by spaces");
    }
    text = text.trim();
    const chars = [...text];
    if (chars.length > o.max) {
      if (!ctx.repair) return fail(ctx, path, `is longer than ${o.max} characters`);
      text = chars.slice(0, o.max).join("").trim();
      note(ctx, path, `was cut to ${o.max} characters`);
    }
    if ([...text].length < min) {
      if (ctx.repair && o.def !== undefined) return o.def;
      return fail(ctx, path, min === 1 ? "must not be empty" : `must have at least ${min} characters`);
    }
    if (o.pattern && !o.pattern.test(text)) {
      if (ctx.repair && o.def !== undefined) {
        note(ctx, path, "was not valid, the default is used");
        return o.def;
      }
      return fail(ctx, path, o.expects ?? "has a wrong format");
    }
    return text;
  };
}

export function oneOf<T extends string>(values: readonly T[], def?: T): Parser<T> {
  return (value, path, ctx) => {
    if (missing(value)) return def !== undefined ? def : fail(ctx, path, "is required");
    if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as T;
    if (ctx.repair && def !== undefined) {
      note(ctx, path, `was not one of ${values.join(", ")}, "${def}" is used`);
      return def;
    }
    return fail(ctx, path, `must be one of: ${values.join(", ")}`);
  };
}

export function bool(def: boolean): Parser<boolean> {
  return (value, path, ctx) => {
    if (missing(value)) return def;
    if (typeof value === "boolean") return value;
    if (ctx.repair) {
      note(ctx, path, "was not true or false, the default is used");
      return def;
    }
    return fail(ctx, path, "must be true or false");
  };
}

export function lit<T extends string | number>(expected: T): Parser<T> {
  return (value, path, ctx) => (value === expected ? expected : fail(ctx, path, `must be ${JSON.stringify(expected)}`));
}

/** The field may be missing. A wrong value is an error in strict mode and is dropped in repair mode. */
export function opt<T>(inner: Parser<T>): Parser<T | undefined> {
  return (value, path, ctx) => {
    if (missing(value)) return undefined;
    const result = inner(value, path, ctx);
    if (result !== FAIL) return result;
    if (!ctx.repair) return FAIL;
    note(ctx, path, "was removed because it was not valid");
    return undefined;
  };
}

interface ArrOptions {
  min: number;
  max: number;
  /** A missing list counts as an empty one (only when `min` is 0). */
  def?: boolean;
}

export function arr<T>(item: Parser<T>, o: ArrOptions): Parser<T[]> {
  return (value, path, ctx) => {
    if (missing(value) && o.def === true && o.min === 0) return [];
    if (!Array.isArray(value)) return fail(ctx, path, "must be a list");
    let source: unknown[] = value;
    if (source.length > o.max) {
      if (!ctx.repair) return fail(ctx, path, `has more than ${o.max} items`);
      source = source.slice(0, o.max);
      note(ctx, path, `was cut to ${o.max} items`);
    }
    const out: T[] = [];
    let failed = false;
    source.forEach((entry, index) => {
      const result = item(entry, join(path, index), ctx);
      if (result === FAIL) {
        if (ctx.repair) note(ctx, join(path, index), "was removed because it could not be repaired");
        else failed = true;
      } else out.push(result);
    });
    if (failed) return FAIL;
    if (out.length < o.min) return fail(ctx, path, `needs at least ${o.min} item${o.min === 1 ? "" : "s"}`);
    return out;
  };
}

export type Shape = Record<string, Parser<unknown>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends Infer<S[K]> ? K : never }[keyof S];
export type ObjOut<S extends Shape> = { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined> };

/** An object with known fields only. `missing: "empty"` reads a missing object as `{}` (all its fields then use their defaults). */
export function obj<S extends Shape>(shape: S, options: { missing?: "empty" } = {}): Parser<ObjOut<S>> {
  return (value, path, ctx) => {
    const source = value === undefined && options.missing === "empty" ? {} : value;
    if (!isRecord(source)) return fail(ctx, path, "must be an object");
    for (const key of Object.keys(source)) {
      if (!(key in shape)) {
        if (ctx.repair) note(ctx, join(path, key), "is not a known field and was removed");
        else fail(ctx, join(path, key), "is not a known field");
      }
    }
    const out: Record<string, unknown> = {};
    let failed = false;
    for (const key of Object.keys(shape)) {
      const parser = shape[key];
      if (!parser) continue;
      const result = parser(source[key], join(path, key), ctx);
      if (result === FAIL) failed = true;
      else if (result !== undefined) out[key] = result;
    }
    return failed ? FAIL : (out as ObjOut<S>);
  };
}

/** Runs `check` on a parsed value (cross-field rules). */
export function refine<T>(inner: Parser<T>, check: (value: T, path: string, ctx: Ctx) => T | Fail): Parser<T> {
  return (value, path, ctx) => {
    const result = inner(value, path, ctx);
    return result === FAIL ? FAIL : check(result, path, ctx);
  };
}

/** A list of object kinds told apart by the text in field `key` (for example `type`). Unknown kinds fail. */
export function variant<M extends Record<string, Parser<unknown>>>(key: string, map: M): Parser<Infer<M[keyof M]>> {
  return (value, path, ctx) => {
    if (!isRecord(value)) return fail(ctx, path, "must be an object");
    const kind = value[key];
    const parser = typeof kind === "string" && Object.prototype.hasOwnProperty.call(map, kind) ? map[kind] : undefined;
    if (!parser) return fail(ctx, join(path, key), `must be one of: ${Object.keys(map).join(", ")}`);
    return parser(value, path, ctx) as Infer<M[keyof M]> | Fail;
  };
}

/** Changes a parsed value (for example to upper case). */
export function map<T, U>(inner: Parser<T>, change: (value: T) => U): Parser<U> {
  return (value, path, ctx) => {
    const result = inner(value, path, ctx);
    return result === FAIL ? FAIL : change(result);
  };
}
