export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Random integer between min and max (inclusive), for human-like jitter. */
export function jitter(min, max) {
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Sleep a random amount between min and max ms. */
export const sleepJitter = (min, max) => sleep(jitter(min, max));
