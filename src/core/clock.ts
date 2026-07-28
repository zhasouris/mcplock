/**
 * Injected time port (CLAUDE.md). This is the ONE sanctioned reader of the wall
 * clock; every time-dependent behaviour (OAuth token expiry, lockfile
 * `resolvedAt`) takes a {@link Clock} so it is deterministic under test. The
 * eslint determinism rule forbids raw `Date` everywhere else in src/.
 */

/** Returns the current time in epoch milliseconds. */
export type Clock = () => number;

/* eslint-disable no-restricted-globals, no-restricted-properties -- the single sanctioned wall-clock reader */
export const systemClock: Clock = () => Date.now();

/**
 * Parse an ISO-8601 string to epoch ms, or undefined if unparseable. Lives here
 * (the time port) because it is the only sanctioned reader of Date. Parsing a
 * given string is deterministic — it does not read the wall clock.
 */
export function parseIsoToMs(iso: string): number | undefined {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}
/* eslint-enable no-restricted-globals, no-restricted-properties */
