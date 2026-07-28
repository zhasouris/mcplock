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
/* eslint-enable no-restricted-globals, no-restricted-properties */
