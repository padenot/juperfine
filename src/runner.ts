import { mean, stddev } from "./stats.js";

export type BenchFn = () => void | Promise<void>;

function getTimer(): () => number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return () => performance.now();
  }
  return () => Date.now();
}

export const timer = getTimer();

export interface SampleOptions {
  // How long to run the warmup phase before collecting samples.
  warmupTime?: number;
  // Minimum number of samples to collect regardless of precision.
  minSamples?: number;
  // Hard cap on samples; stops here even if precision target isn't met.
  maxSamples?: number;
  // Stop collecting once (stddev / sqrt(n)) / mean drops below this fraction.
  targetPrecision?: number;
}

export interface SampleResult {
  // Per-iteration time in ms. Each value is already divided by itersPerSample.
  samples: number[];
  // How many fn() calls were batched per timed measurement.
  itersPerSample: number;
}

export async function collectSamples(fn: BenchFn, opts: SampleOptions = {}): Promise<SampleResult> {
  const {
    warmupTime = 500,
    minSamples = 30,
    maxSamples = 300,
    targetPrecision = 0.01,
  } = opts;

  const isAsync = fn.constructor.name === "AsyncFunction";

  async function runBatch(n: number): Promise<void> {
    if (isAsync) {
      for (let i = 0; i < n; i++) await (fn as () => Promise<void>)();
    } else {
      for (let i = 0; i < n; i++) (fn as () => void)();
    }
  }

  // Find the smallest batch size that gives >= 0.5ms per measurement.
  // This avoids timer-resolution noise for very fast functions.
  let iters = 1;
  while (iters < 1_000_000) {
    const t0 = timer();
    await runBatch(iters);
    if (timer() - t0 >= 0.5) break;
    iters *= 2;
  }

  const warmupEnd = timer() + warmupTime;
  while (timer() < warmupEnd) await runBatch(iters);

  const samples: number[] = [];
  while (samples.length < maxSamples) {
    const t0 = timer();
    await runBatch(iters);
    samples.push((timer() - t0) / iters);

    if (samples.length >= minSamples) {
      const m = mean(samples);
      if (m > 0 && stddev(samples) / Math.sqrt(samples.length) / m <= targetPrecision) break;
    }
  }

  return { samples, itersPerSample: iters };
}
