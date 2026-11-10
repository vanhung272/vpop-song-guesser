/** Server time source (ruling R7). Injected so tests can drive phase deadlines with a fake clock. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
