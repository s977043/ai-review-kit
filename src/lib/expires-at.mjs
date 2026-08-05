/**
 * The single definition of what a valid `expiresAt` value is (#1768).
 *
 * Before this module the answer was given in three places that disagreed:
 *
 * | 定義      | 場所                                            | 基準                                  |
 * | --------- | ----------------------------------------------- | ------------------------------------- |
 * | schema    | `schemas/suppression-context.schema.json`       | `format: date-time` (RFC 3339)        |
 * | CLI       | `parseExpiresAt` in `src/cli.mjs` (#1757)       | RFC 3339 `full-date` / `date-time`    |
 * | library   | `hasUnparseableExpiresAt` (#1762)               | `Date.parse` is not NaN               |
 *
 * `Date.parse` accepts `"0"`, `"2026"` and `"2026-08-04 10:00"`, so the library
 * treated as a valid deadline three values the schema rejects and the CLI exits
 * 1 on. Each of them is then read at a time nobody wrote: `new Date('2026')` is
 * 2026-01-01T00:00:00Z and `new Date('0')` is 2000-01-01T00:00:00Z. An entry
 * could therefore be archived, and `expiresAt reached` written to its
 * append-only audit trail, on the strength of a string the schema forbids.
 *
 * Every consumer now goes through `parseExpiresAt` below. The accepted set is
 * unchanged from the CLI's (#1757): this module was moved out of `src/cli.mjs`,
 * not rewritten, so `--expires` keeps exactly the public contract it had.
 */

/** RFC 3339 `full-date` (`2027-01-01`). */
const RFC3339_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** RFC 3339 `date-time` (`2027-01-01T00:00:00Z`, `...+09:00`, optional fraction). */
const RFC3339_DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/**
 * Validate an `expiresAt` value and normalize it to the `date-time` form that
 * `schemas/suppression-context.schema.json` declares for `context.expiresAt`.
 *
 * Shape is checked with the two RFC 3339 patterns above rather than with
 * `Date.parse` alone, because `Date.parse` also accepts `2027` and
 * `March 5, 2027` — values `createSuppression` would then store verbatim and
 * the schema would reject.
 *
 * The calendar day is then checked by round-tripping through `Date.UTC`,
 * because `Date.parse` does NOT reject an impossible day: it rolls
 * `2027-02-30` over to 2027-03-02 (measured on Node 22.22.2). Silently
 * expiring on a different day than the one that was typed is the same class of
 * bug as the rest of this fix, so an overflowing day is rejected.
 *
 * A date-only input is read as UTC midnight, matching how `new Date()` already
 * interprets the date-only ISO form.
 *
 * @param {string} value
 * @returns {string | null} normalized ISO date-time, or null when invalid
 */
export function parseExpiresAt(value) {
  if (typeof value !== 'string') return null;
  if (!RFC3339_DATE.test(value) && !RFC3339_DATE_TIME.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

/**
 * The instant an `expiresAt` value denotes, or `NaN` when the value is not a
 * valid `expiresAt` at all.
 *
 * Read-side counterpart of `parseExpiresAt` for callers that need to COMPARE a
 * deadline rather than store it. Returning `NaN` (rather than throwing or
 * returning null) keeps the shape `Date.parse` had, so the caller still decides
 * what an invalid value means — `isExpired`'s `onUnparseable` contract (#1756)
 * is unchanged by this module.
 *
 * @param {string} value
 * @returns {number} epoch milliseconds, or NaN
 */
export function expiresAtTimestamp(value) {
  const normalized = parseExpiresAt(value);
  return normalized === null ? Number.NaN : Date.parse(normalized);
}
