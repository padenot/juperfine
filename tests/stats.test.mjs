// Tests for stats.ts.
//
// Mann-Whitney U statistics are cross-checked against scipy.stats.mannwhitneyu
// (see tests/generate-fixtures.py for how expected values were produced).
// Bootstrap CI values cannot be checked numerically against scipy because we
// use mulberry32 while numpy uses PCG64; instead we verify medianDiff exactly
// and check statistical properties of the CI.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  sorted, median, mean, stddev, percentile,
  detectOutliers, bootstrapCI, bootstrapDiffCI, mannWhitneyU,
} from "../dist/stats.js";

function approxEqual(a, b, tol) {
  return Math.abs(a - b) <= tol;
}
function assertApprox(a, b, tol, label) {
  assert(approxEqual(a, b, tol), `${label}: expected ${b}, got ${a} (tol=${tol})`);
}
// Check that a is within `pct`% of b.
function assertRelative(a, b, pct, label) {
  const rel = Math.abs(a - b) / Math.abs(b);
  assert(rel <= pct / 100, `${label}: expected ${b} ± ${pct}%, got ${a} (rel error ${(rel*100).toFixed(2)}%)`);
}

// ---------------------------------------------------------------------------
// median
// ---------------------------------------------------------------------------

test("median: odd length", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([5, 1, 3, 7, 9]), 5);
});

test("median: even length", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([10, 20, 30, 40]), 25);
});

test("median: single element", () => {
  assert.equal(median([42]), 42);
});

test("median: unsorted input", () => {
  assert.equal(median([9, 1, 5, 3, 7]), 5);
});

// ---------------------------------------------------------------------------
// mean / stddev
// ---------------------------------------------------------------------------

test("mean", () => {
  assertApprox(mean([1, 2, 3, 4, 5]), 3, 1e-10, "mean 1..5");
  assertApprox(mean([0, 10]), 5, 1e-10, "mean [0,10]");
});

test("stddev: known value", () => {
  // [2,4,4,4,5,5,7,9]: sample stddev verified with numpy.std(..., ddof=1)
  assertApprox(stddev([2, 4, 4, 4, 5, 5, 7, 9]), 2.1380899352993947, 1e-10, "stddev");
});

test("stddev: constant data", () => {
  assert.equal(stddev([5, 5, 5, 5]), 0);
});

// ---------------------------------------------------------------------------
// percentile
// ---------------------------------------------------------------------------

test("percentile: standard quantiles", () => {
  const s = sorted([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assertApprox(percentile(s, 0),   1,    1e-10, "p0");
  assertApprox(percentile(s, 100), 10,   1e-10, "p100");
  assertApprox(percentile(s, 50),  5.5,  1e-10, "p50");
  assertApprox(percentile(s, 25),  3.25, 1e-10, "p25");
  assertApprox(percentile(s, 75),  7.75, 1e-10, "p75");
});

// ---------------------------------------------------------------------------
// detectOutliers (Tukey's fences)
// ---------------------------------------------------------------------------

test("detectOutliers: no outliers in uniform data", () => {
  const { mild, severe } = detectOutliers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(mild, 0);
  assert.equal(severe, 0);
});

test("detectOutliers: mild outlier", () => {
  // 30 values alternating 9.9/10.1 → with n=31 after adding outlier:
  //   Q1=9.9, Q3=10.1, IQR=0.2, mild fences=[9.6, 10.4], severe fences=[9.3, 10.7]
  //   10.5 lies in (10.4, 10.7] → mild
  const base = Array.from({ length: 30 }, (_, i) => i < 15 ? 9.9 : 10.1);
  const { mild, severe } = detectOutliers([...base, 10.5]);
  assert.equal(mild, 1);
  assert.equal(severe, 0);
});

test("detectOutliers: severe outlier", () => {
  // 100 > 21.25 → severe
  const { mild, severe } = detectOutliers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100]);
  assert.equal(mild, 0);
  assert.equal(severe, 1);
});

test("detectOutliers: symmetric outliers on both sides", () => {
  const base = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const { mild: m0 } = detectOutliers(base);
  assert.equal(m0, 0);
  const { mild: m1 } = detectOutliers([...base, 1, 30]);
  assert(m1 >= 1);
});

// ---------------------------------------------------------------------------
// bootstrapDiffCI
// Exact numerical cross-check is not possible (mulberry32 ≠ numpy PCG64),
// so we verify: medianDiff is exact, CI brackets medianDiff, sign is correct.
// ---------------------------------------------------------------------------

test("bootstrapDiffCI: medianDiff matches exactly (cross-check scipy)", () => {
  // scipy expected medianDiff = -2.0
  const base =     [10.0, 10.1, 9.9, 10.2, 9.8, 10.0, 10.1, 9.9, 10.0, 10.1];
  const candidate = [8.0,  8.1,  7.9,  8.2,  7.8,  8.0,  8.1,  7.9,  8.0,  8.1];
  const { medianDiff, lo, hi, significant } = bootstrapDiffCI(base, candidate);
  assertApprox(medianDiff, -2.0, 1e-10, "medianDiff");
  assert(lo < medianDiff && medianDiff < hi, "medianDiff should be inside CI");
  assert.equal(significant, true, "CI should not contain 0");
  assert(hi < 0, "entire CI should be negative (candidate is faster)");
});

test("bootstrapDiffCI: no difference", () => {
  // scipy expected medianDiff = 0.0, significant = false
  const data = [5.0, 5.1, 4.9, 5.0, 5.2, 4.8, 5.0, 5.1, 4.9, 5.0];
  const { medianDiff, lo, hi, significant } = bootstrapDiffCI(data, data);
  assertApprox(medianDiff, 0.0, 1e-10, "medianDiff");
  assert(lo <= 0 && hi >= 0, "CI should contain 0 for identical datasets");
  assert.equal(significant, false);
});

test("bootstrapDiffCI: CI is reproducible with same seed", () => {
  const base      = [10, 11, 12, 13, 14];
  const candidate = [8,  9,  10, 11, 12];
  const r1 = bootstrapDiffCI(base, candidate, 1000, 0.05, 42);
  const r2 = bootstrapDiffCI(base, candidate, 1000, 0.05, 42);
  assert.equal(r1.lo, r2.lo);
  assert.equal(r1.hi, r2.hi);
});

test("bootstrapDiffCI: different seed gives different CI bounds for continuous data", () => {
  // Use continuous data (irrational-ish values) so CI percentiles fall at distinct points.
  const base      = [10.123, 10.456, 9.789, 10.234, 9.901, 10.345, 9.867, 10.012, 10.189, 9.956];
  const candidate = [8.234,  8.567, 7.890, 8.345,  7.912, 8.456,  7.978, 8.123,  8.290,  8.067];
  const r1 = bootstrapDiffCI(base, candidate, 1000, 0.05, 42);
  const r2 = bootstrapDiffCI(base, candidate, 1000, 0.05, 99);
  assert(r1.lo !== r2.lo || r1.hi !== r2.hi, "different seeds should produce different CI bounds");
});

// ---------------------------------------------------------------------------
// bootstrapCI (single sample)
// ---------------------------------------------------------------------------

test("bootstrapCI: CI contains true median", () => {
  // For a tight cluster around 10.0, the CI should contain 10.0.
  const data = [
    10.0, 10.1, 9.9, 10.2, 9.8, 10.0, 10.1, 9.9, 10.0, 10.1,
    10.0, 10.1, 9.9, 10.2, 9.8, 10.0, 10.1, 9.9, 10.0, 10.1,
  ];
  const { lo, hi } = bootstrapCI(data);
  assert(lo <= 10.0 && 10.0 <= hi, `CI [${lo}, ${hi}] should contain 10.0`);
});

test("bootstrapCI: wider CI for noisier data", () => {
  const tight = Array.from({ length: 50 }, (_, i) => 10 + (i % 2 === 0 ? 0.01 : -0.01));
  const noisy = Array.from({ length: 50 }, (_, i) => 10 + (i % 2 === 0 ? 1 : -1));
  const ciTight = bootstrapCI(tight);
  const ciNoisy = bootstrapCI(noisy);
  assert(
    (ciNoisy.hi - ciNoisy.lo) > (ciTight.hi - ciTight.lo),
    "noisier data should produce a wider CI",
  );
});

test("bootstrapCI: is reproducible with same seed", () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const r1 = bootstrapCI(data, 500, 0.05, 42);
  const r2 = bootstrapCI(data, 500, 0.05, 42);
  assert.equal(r1.lo, r2.lo);
  assert.equal(r1.hi, r2.hi);
});

// ---------------------------------------------------------------------------
// mannWhitneyU — U statistic cross-checked exactly against scipy.
// p-values for small n use normal approximation (not exact distribution),
// so we allow a generous tolerance there; significance flags should match.
// ---------------------------------------------------------------------------

test("mannWhitneyU: clearly separated — U exact, p significant (cross-check scipy)", () => {
  // scipy: u=0.0, p=0.007937, significant=true
  const { u, p, significant } = mannWhitneyU([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
  assertApprox(u, 0, 1e-9, "U statistic");
  assert(p < 0.05, `p=${p} should be significant`);
  assert.equal(significant, true);
  // Our normal approx for n=5 vs scipy exact: allow 50% relative tolerance
  assertRelative(p, 0.007936507936507936, 50, "p-value approx");
});

test("mannWhitneyU: no difference — U exact, p=1 (cross-check scipy)", () => {
  // scipy: u=12.5, p=1.0, significant=false
  const { u, p, significant } = mannWhitneyU([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
  assertApprox(u, 12.5, 1e-9, "U statistic");
  assertApprox(p, 1.0, 1e-6, "p-value");
  assert.equal(significant, false);
});

test("mannWhitneyU: partial overlap — U exact, not significant (cross-check scipy)", () => {
  // scipy: u=10.0, p=0.240, significant=false
  const { u, p, significant } = mannWhitneyU(
    [10, 20, 30, 40, 50, 60],
    [25, 35, 45, 55, 65, 75],
  );
  assertApprox(u, 10, 1e-9, "U statistic");
  assert(p >= 0.05, `p=${p} should not be significant`);
  assert.equal(significant, false);
  assertRelative(p, 0.24025974025974026, 30, "p-value approx");
});

test("mannWhitneyU: ties — U exact (cross-check scipy)", () => {
  // scipy: u=5.0, p=0.125, significant=false
  const { u, p, significant } = mannWhitneyU(
    [1, 1, 2, 2, 3],
    [2, 2, 3, 3, 4],
  );
  assertApprox(u, 5, 1e-9, "U statistic");
  assert(p >= 0.05, `p=${p} should not be significant`);
  assert.equal(significant, false);
});

test("mannWhitneyU: larger samples — normal approx agrees well with scipy (cross-check scipy)", () => {
  // scipy: u=50.0, p=5.2125e-05, significant=true
  // n=20 each: normal approx should be within a few percent
  const { u, p, significant } = mannWhitneyU(
    Array.from({ length: 20 }, (_, i) => i + 1),
    Array.from({ length: 20 }, (_, i) => i + 11),
  );
  assertApprox(u, 50, 1e-9, "U statistic");
  assert(p < 0.05, `p=${p} should be significant`);
  assert.equal(significant, true);
  assertRelative(p, 5.2125496206037515e-5, 20, "p-value approx");
});

test("mannWhitneyU: symmetric: U statistic equals n1*n2/2 for identical distributions", () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8];
  const b = [1, 2, 3, 4, 5, 6, 7, 8];
  const { u } = mannWhitneyU(a, b);
  assertApprox(u, a.length * b.length / 2, 1e-6, "U = n1*n2/2 for identical data");
});
