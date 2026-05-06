import { test } from "node:test";
import { strict as assert } from "node:assert";
import { checkSamples } from "../dist/warnings.js";

function hasWarning(warnings, fragment) {
  return warnings.some(w => w.message.includes(fragment));
}
function hasLevel(warnings, level, fragment) {
  return warnings.some(w => w.level === level && w.message.includes(fragment));
}

// ---------------------------------------------------------------------------
// High variance
// ---------------------------------------------------------------------------

test("no warnings for stable data", () => {
  const stable = Array.from({ length: 50 }, (_, i) => 10 + (i % 3 === 0 ? 0.1 : -0.1));
  const w = checkSamples(stable);
  assert(!hasWarning(w, "variance"), `unexpected variance warning on stable data: ${JSON.stringify(w)}`);
});

test("warn on high variance (CV > 5%)", () => {
  // mean=10, stddev=1 → CV=10%
  const noisy = Array.from({ length: 50 }, (_, i) => 10 + (i % 2 === 0 ? 1 : -1));
  const w = checkSamples(noisy);
  assert(hasWarning(w, "variance"), "should warn about high variance");
});

test("error on very high variance (CV > 20%)", () => {
  // mean=10, stddev=3 → CV=30%
  const veryNoisy = Array.from({ length: 50 }, (_, i) => 10 + (i % 2 === 0 ? 3 : -3));
  const w = checkSamples(veryNoisy);
  assert(hasLevel(w, "error", "variance"), "should error on very high variance");
});

// ---------------------------------------------------------------------------
// Outlier detection
// ---------------------------------------------------------------------------

test("no outlier warning for clean data", () => {
  const clean = Array.from({ length: 30 }, (_, i) => 10 + i * 0.01);
  const w = checkSamples(clean);
  assert(!hasWarning(w, "outlier"), `unexpected outlier warning: ${JSON.stringify(w)}`);
});

test("warn on mild outliers", () => {
  const data = [
    ...Array.from({ length: 40 }, () => 10),
    150, // clearly a mild/severe outlier
  ];
  const w = checkSamples(data);
  assert(hasWarning(w, "outlier"), "should warn about outlier");
});

test("error on severe outliers", () => {
  const data = [
    ...Array.from({ length: 40 }, () => 10),
    10000,
  ];
  const w = checkSamples(data);
  assert(hasLevel(w, "error", "outlier"), "should error on severe outlier");
});

// ---------------------------------------------------------------------------
// Timer resolution
// ---------------------------------------------------------------------------

test("warn when > 50% of samples are duplicate values", () => {
  // All the same value → terrible timer resolution
  const lowRes = Array.from({ length: 30 }, () => 1.0);
  const w = checkSamples(lowRes);
  assert(hasWarning(w, "resolution"), "should warn about timer resolution");
});

test("no resolution warning for all-distinct values", () => {
  const distinct = Array.from({ length: 30 }, (_, i) => i * 0.1 + 1);
  const w = checkSamples(distinct);
  assert(!hasWarning(w, "resolution"), `unexpected resolution warning: ${JSON.stringify(w)}`);
});

// ---------------------------------------------------------------------------
// Warmup instability
// ---------------------------------------------------------------------------

test("warn when early samples are much slower than steady state", () => {
  // First 10% of samples are 5× slower than the rest
  const n = 50;
  const split = Math.ceil(n * 0.1);
  const samples = [
    ...Array.from({ length: split }, () => 50),   // slow early phase
    ...Array.from({ length: n - split }, () => 10), // fast steady state
  ];
  const w = checkSamples(samples);
  assert(hasWarning(w, "instability"), `should warn about warmup instability: ${JSON.stringify(w)}`);
});

test("no warmup warning when samples are stable throughout", () => {
  const stable = Array.from({ length: 50 }, () => 10);
  const w = checkSamples(stable);
  assert(!hasWarning(w, "instability"), `unexpected warmup warning: ${JSON.stringify(w)}`);
});

test("no warmup warning when sample count is too small to detect", () => {
  // With only 5 samples the split * 3 guard prevents the check.
  const w = checkSamples([50, 50, 10, 10, 10]);
  assert(!hasWarning(w, "instability"));
});
