/**
 * Deterministic seeded random numbers. Simulation, terrain generation, and
 * replays must never depend on Math.random(): the same seed has to produce
 * the same world on every machine and every run.
 */

/** mulberry32: small, fast, and statistically fine for gameplay use. */
export function createRng(seed = 1) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed: state,
    /** Float in [0, 1). */
    next,
    /** Integer in [min, max] inclusive. */
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    /** Pick one element of a non-empty array. */
    pick(items) { return items[Math.floor(next() * items.length)]; },
    /** True with probability p. */
    chance(p) { return next() < p; }
  };
}

/** A 32-bit seed from anywhere (string labels, timestamps, user input). */
export function toSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
