import { fitKdeModes, type KDEModeResult } from "./kde.js";

export type { KDEModeResult };

export interface ModeStats {
  location: number;
  fraction: number;
}

// Fit a KDE to the samples and identify distinct modes.
// Returns null when there are too few samples or the KDE fails.
export function analyzeModes(samples: number[]): KDEModeResult | null {
  if (samples.length < 15) return null;
  try {
    return fitKdeModes(samples);
  } catch {
    return null;
  }
}

// For each mode boundary, count the fraction of samples that falls in that mode.
export function modeStats(samples: number[], result: KDEModeResult): ModeStats[] {
  const { peakLocs, boundaries } = result;
  return peakLocs.map((loc, i) => {
    const lo = i === 0 ? -Infinity : boundaries[i - 1];
    const hi = i === peakLocs.length - 1 ? Infinity : boundaries[i];
    const count = samples.filter(s => s >= lo && s < hi).length;
    return { location: loc, fraction: count / samples.length };
  });
}

export function sorted(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b);
}

// Matches the implementation cross-verified against scipy in perfcompare-new-stats.
export function median(arr: ArrayLike<number>): number {
  const s = new Float64Array(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

export function mean(arr: number[]): number {
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

export function stddev(arr: number[]): number {
  const m = mean(arr);
  let ss = 0;
  for (const v of arr) ss += (v - m) ** 2;
  return Math.sqrt(ss / (arr.length - 1));
}

export function percentile(s: number[], p: number): number {
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (idx - lo) * (s[hi] - s[lo]);
}

export interface OutlierCount {
  mild: number;
  severe: number;
}

export function detectOutliers(samples: number[]): OutlierCount {
  const s = sorted(samples);
  const q1 = percentile(s, 25);
  const q3 = percentile(s, 75);
  const iqr = q3 - q1;
  const mildLo = q1 - 1.5 * iqr, mildHi = q3 + 1.5 * iqr;
  const severeLo = q1 - 3 * iqr, severeHi = q3 + 3 * iqr;
  let mild = 0, severe = 0;
  for (const v of samples) {
    if (v < severeLo || v > severeHi) severe++;
    else if (v < mildLo || v > mildHi) mild++;
  }
  return { mild, severe };
}

// Mulberry32 — fast seedable PRNG so results are reproducible.
// Matches perfcompare-new-stats/standalone-stats/bootstrap-ci.ts.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function resample(arr: Float64Array, rng: () => number): Float64Array {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = arr[Math.floor(rng() * arr.length)];
  }
  return out;
}

export interface BootstrapCI {
  lo: number;
  hi: number;
}

// Bootstrap CI for the median of a single sample.
export function bootstrapCI(
  data: number[],
  nIter = 1000,
  alpha = 0.05,
  seed = 42,
): BootstrapCI {
  const rng = mulberry32(seed);
  const arr = new Float64Array(data);
  const medians = new Float64Array(nIter);
  for (let i = 0; i < nIter; i++) medians[i] = median(resample(arr, rng));
  medians.sort();
  return {
    lo: medians[Math.floor((alpha / 2) * nIter)],
    hi: medians[Math.min(Math.floor((1 - alpha / 2) * nIter), nIter - 1)],
  };
}

export interface DiffCI extends BootstrapCI {
  medianDiff: number;
  significant: boolean;
}

// Percentile bootstrap CI for (median(candidate) - median(baseline)).
// Matches scipy.stats.bootstrap(..., method="percentile", paired=False).
// Derived from perfcompare-new-stats/standalone-stats/bootstrap-ci.ts (bootstrapMedianDiffCI).
export function bootstrapDiffCI(
  baseline: number[],
  candidate: number[],
  nIter = 1000,
  alpha = 0.05,
  seed = 42,
): DiffCI {
  const rng = mulberry32(seed);
  const baseArr = new Float64Array(baseline);
  const candArr = new Float64Array(candidate);
  const diffs = new Float64Array(nIter);
  for (let i = 0; i < nIter; i++) {
    diffs[i] = median(resample(candArr, rng)) - median(resample(baseArr, rng));
  }
  diffs.sort();
  const lo = diffs[Math.floor((alpha / 2) * nIter)];
  const hi = diffs[Math.min(Math.floor((1 - alpha / 2) * nIter), nIter - 1)];
  return {
    medianDiff: median(candidate) - median(baseline),
    lo,
    hi,
    significant: lo > 0 || hi < 0,
  };
}

// Normal CDF via Abramowitz & Stegun 26.2.17.
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const d = Math.exp(-0.5 * x * x) / 2.5066282746310002;
  const cdf = 1 - d * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

export interface MannWhitneyResult {
  u: number;
  p: number;
  significant: boolean;
}

export function mannWhitneyU(a: number[], b: number[]): MannWhitneyResult {
  const n1 = a.length, n2 = b.length;
  const combined = [
    ...a.map(v => ({ v, g: 0 })),
    ...b.map(v => ({ v, g: 1 })),
  ].sort((x, y) => x.v - y.v);
  const N = combined.length;

  const ranks = new Float64Array(N);
  for (let i = 0; i < N; ) {
    let j = i;
    while (j < N && combined[j].v === combined[i].v) j++;
    const avg = (i + j + 1) / 2; // 1-indexed average rank
    for (let k = i; k < j; k++) ranks[k] = avg;
    i = j;
  }

  let r1 = 0;
  for (let k = 0; k < N; k++) if (combined[k].g === 0) r1 += ranks[k];
  const u1 = r1 - n1 * (n1 + 1) / 2;
  const u = Math.min(u1, n1 * n2 - u1);

  let tieSum = 0;
  for (let i = 0; i < N; ) {
    let j = i;
    while (j < N && combined[j].v === combined[i].v) j++;
    const t = j - i;
    if (t > 1) tieSum += t ** 3 - t;
    i = j;
  }

  const varU = (n1 * n2 / 12) * ((N + 1) - tieSum / (N * (N - 1)));
  if (varU <= 0) return { u, p: 1, significant: false };
  const z = (u - n1 * n2 / 2) / Math.sqrt(varU);
  const p = 2 * normalCDF(-Math.abs(z));
  return { u, p, significant: p < 0.05 };
}
