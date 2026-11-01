/**
 * Small helpers shared by the D1 repositories.
 *
 * The D1 binding itself is never cached here: on Workers it arrives per request
 * as `c.env.DB`, and a module-level reference would be captured from whichever
 * request happened to warm the isolate. Repositories take `db` as an argument.
 */

/** SQLite has no boolean type; columns are INTEGER 0/1. */
export const toBool = (v: unknown): boolean => v === 1 || v === true

/**
 * ISO-8601, which sorts lexicographically. Every timestamp written anywhere in
 * the app must go through this — mixed formats silently break ORDER BY.
 */
export const now = (): string => new Date().toISOString()

/** JSON columns are TEXT; parse at the repository boundary, never in a route. */
export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v.length === 0) return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

/** JSON columns are TEXT; serialise once at the repository boundary. */
export const stringifyJson = (value: unknown): string => JSON.stringify(value)

/** Fresh identifier for a TEXT primary key. */
export const newId = (): string => crypto.randomUUID()
