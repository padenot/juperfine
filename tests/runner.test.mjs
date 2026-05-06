import { test } from "node:test";
import { strict as assert } from "node:assert";
import { collectSamples } from "../dist/runner.js";

// ---------------------------------------------------------------------------
// Adaptive stopping
// ---------------------------------------------------------------------------

test("collects at least minSamples", async () => {
  let calls = 0;
  const { samples } = await collectSamples(() => { calls++; }, { minSamples: 30, warmupTime: 0 });
  assert(samples.length >= 30, `expected >= 30 samples, got ${samples.length}`);
});

test("respects maxSamples cap", async () => {
  // Very noisy function: never converges, should stop at cap.
  let v = 0;
  const { samples } = await collectSamples(
    () => { v = Math.random() * 1000; },
    { minSamples: 5, maxSamples: 20, warmupTime: 0, targetPrecision: 1e-10 },
  );
  assert(samples.length <= 20, `expected <= 20 samples, got ${samples.length}`);
});

test("stops early for stable function when precision met", async () => {
  // A stable function (constant work) should converge well before maxSamples.
  const { samples } = await collectSamples(
    () => { let s = 0; for (let i = 0; i < 10000; i++) s += i; return s; },
    { minSamples: 10, maxSamples: 300, warmupTime: 100, targetPrecision: 0.05 },
  );
  assert(samples.length < 300, `expected early stopping, got all ${samples.length} samples`);
});

// ---------------------------------------------------------------------------
// Calibration (itersPerSample)
// ---------------------------------------------------------------------------

test("calibrates itersPerSample > 1 for very fast functions", async () => {
  const { itersPerSample } = await collectSamples(
    () => { /* near-zero work */ },
    { warmupTime: 0, minSamples: 10 },
  );
  assert(itersPerSample > 1, `expected calibration, got itersPerSample=${itersPerSample}`);
});

test("itersPerSample = 1 for slow-enough functions", async () => {
  // Spin for >= 1ms each call to ensure no batching needed.
  const { itersPerSample } = await collectSamples(
    () => {
      const end = Date.now() + 2;
      while (Date.now() < end) { /* spin */ }
    },
    { warmupTime: 0, minSamples: 5, maxSamples: 5 },
  );
  assert.equal(itersPerSample, 1);
});

// ---------------------------------------------------------------------------
// Async support
// ---------------------------------------------------------------------------

test("works with async functions", async () => {
  let calls = 0;
  const { samples } = await collectSamples(
    async () => { calls++; await Promise.resolve(); },
    { warmupTime: 0, minSamples: 15, maxSamples: 30 },
  );
  assert(samples.length >= 15, `expected >= 15 samples, got ${samples.length}`);
  assert(calls > 0, "async fn should have been called");
});

test("async and sync functions produce positive sample values", async () => {
  const { samples: sync } = await collectSamples(
    () => { let s = 0; for (let i = 0; i < 1000; i++) s += i; return s; },
    { warmupTime: 0, minSamples: 10, maxSamples: 10 },
  );
  const { samples: async_ } = await collectSamples(
    async () => { await Promise.resolve(42); },
    { warmupTime: 0, minSamples: 10, maxSamples: 10 },
  );
  assert(sync.every(v => v > 0), "sync samples should be positive");
  assert(async_.every(v => v > 0), "async samples should be positive");
});

// ---------------------------------------------------------------------------
// Sample values
// ---------------------------------------------------------------------------

test("samples are per-iteration times (divided by itersPerSample)", async () => {
  // For a function that takes ~0ms the samples should still be non-negative
  // and itersPerSample should compensate so each sample is plausible.
  const { samples, itersPerSample } = await collectSamples(
    () => { /* minimal work */ },
    { warmupTime: 0, minSamples: 10, maxSamples: 10 },
  );
  assert(samples.every(v => v >= 0), "all samples should be >= 0");
  assert(itersPerSample >= 1);
});
