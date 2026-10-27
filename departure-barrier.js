// Multiple removals can overlap. Settlement waits for every visible departure.
export function createDepartureBarrier(now = () => performance.now()) {
  let deadline = 0;
  return {
    add(duration) { deadline = Math.max(deadline, now() + Math.max(0, duration)); },
    remaining() { return Math.max(0, deadline - now()); },
    clear() { deadline = 0; },
  };
}
