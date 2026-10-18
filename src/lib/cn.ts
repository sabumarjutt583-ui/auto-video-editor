type ClassValue = string | false | null | undefined;

/** Joins class names, skipping empty values. */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
