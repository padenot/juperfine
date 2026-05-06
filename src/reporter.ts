import { median, mean, stddev, sorted, percentile, bootstrapCI, bootstrapDiffCI, mannWhitneyU, analyzeModes, modeStats, type KDEModeResult } from "./stats.js";
import { checkSamples, type Warning } from "./warnings.js";

export function output(s: string): void {
  if (typeof console !== "undefined") {
    console.log(s);
  } else {
    // SpiderMonkey shell without console
    // @ts-ignore
    print(s);
  }
}

export function formatTime(ms: number): string {
  if (ms < 1e-3) return `${(ms * 1e6).toFixed(3)} ns`;
  if (ms < 1) return `${(ms * 1e3).toFixed(3)} µs`;
  if (ms < 1000) return `${ms.toFixed(3)} ms`;
  return `${(ms / 1000).toFixed(3)} s`;
}

export interface ModeInfo {
  nModes: number;
  // Each mode's peak location (in ms) and the fraction of samples it contains.
  modes: Array<{ location: number; fraction: number }>;
}

export interface BenchRecord {
  type: "bench";
  name: string;
  median: number;
  mean: number;
  stddev: number;
  ciLow: number;
  ciHigh: number;
  min: number;
  max: number;
  p99: number;
  itersPerSample: number;
  samples: number[];
  warnings: Warning[];
  distribution: ModeInfo;
}

const BLOCKS = " ▁▂▃▄▅▆▇█";
const CHART_HEIGHT = 8;

function chartWidth(): number {
  try {
    // @ts-ignore
    if (typeof process !== "undefined" && process.stdout?.columns) return process.stdout.columns - 2;
  } catch {}
  return 120;
}

function kdeColumns(kde: KDEModeResult, xMin: number, xMax: number, w: number): Float64Array {
  const range = xMax - xMin || 1;
  const buckets = new Float64Array(w);
  for (let i = 0; i < kde.x.length; i++) {
    const col = Math.min(w - 1, Math.floor((kde.x[i] - xMin) / range * w));
    if (kde.y[i] > buckets[col]) buckets[col] = kde.y[i];
  }
  return buckets;
}

function renderRows(buckets: Float64Array, h: number): string[] {
  let yMax = 0;
  for (let i = 0; i < buckets.length; i++) if (buckets[i] > yMax) yMax = buckets[i];
  const rows: string[] = [];
  for (let r = 0; r < h; r++) {
    let row = "";
    for (let c = 0; c < buckets.length; c++) {
      const fill = yMax > 0 ? Math.round((buckets[c] / yMax) * h * 8) : 0;
      const floor = (h - 1 - r) * 8;
      const ceil = (h - r) * 8;
      row += fill >= ceil ? "█" : fill > floor ? BLOCKS[fill - floor] : " ";
    }
    rows.push(`  ${row}`);
  }
  return rows;
}

function axisLine(xMin: number, xMax: number, w: number): string {
  const left = formatTime(xMin), right = formatTime(xMax);
  return `  ${left}${" ".repeat(Math.max(1, w - left.length - right.length))}${right}`;
}

function renderChart(kde: KDEModeResult): string {
  const w = chartWidth();
  const xMin = kde.x[0], xMax = kde.x[kde.x.length - 1];
  return [...renderRows(kdeColumns(kde, xMin, xMax, w), CHART_HEIGHT), axisLine(xMin, xMax, w)].join("\n");
}

function renderCompareCharts(bKde: KDEModeResult, cKde: KDEModeResult): string {
  const w = chartWidth();
  const xMin = Math.min(bKde.x[0], cKde.x[0]);
  const xMax = Math.max(bKde.x[bKde.x.length - 1], cKde.x[cKde.x.length - 1]);
  return [
    ...renderRows(kdeColumns(bKde, xMin, xMax, w), CHART_HEIGHT),
    ...renderRows(kdeColumns(cKde, xMin, xMax, w), CHART_HEIGHT),
    axisLine(xMin, xMax, w),
  ].join("\n");
}

interface DistributionResult {
  info: ModeInfo;
  kde: KDEModeResult | null;
}

function computeDistribution(samples: number[]): DistributionResult {
  const result = analyzeModes(samples);
  if (!result) return { info: { nModes: 1, modes: [{ location: median(samples), fraction: 1 }] }, kde: null };
  const stats = modeStats(samples, result);
  return {
    info: { nModes: result.nModes, modes: stats.map((s, i) => ({ location: result.peakLocs[i], fraction: s.fraction })) },
    kde: result,
  };
}

export function reportBench(name: string, samples: number[], itersPerSample: number): BenchRecord {
  const s = sorted(samples);
  const med = median(samples);
  const m = mean(samples);
  const sd = stddev(samples);
  const ci = bootstrapCI(samples);
  const p99 = percentile(s, 99);
  const warnings = checkSamples(samples);
  const { info: distribution, kde } = computeDistribution(samples);

  output(`\nbench: ${name}${itersPerSample > 1 ? `  (batched: ${itersPerSample} iter/sample)` : ""}`);
  output(`  samples:  ${samples.length}`);
  output(`  median:   ${formatTime(med)}  [${formatTime(ci.lo)}, ${formatTime(ci.hi)}] 95% CI`);
  output(`  mean:     ${formatTime(m)} ± ${formatTime(sd)}`);
  output(`  range:    [${formatTime(s[0])}, ${formatTime(s[s.length - 1])}]  p99: ${formatTime(p99)}`);
  if (kde) output(renderChart(kde));

  if (distribution.nModes >= 2) {
    const modeStr = distribution.modes
      .map(mo => `${formatTime(mo.location)} (${(mo.fraction * 100).toFixed(0)}%)`)
      .join("  /  ");
    output(`  ⚠ Multimodal distribution (${distribution.nModes} modes): ${modeStr}`);
    output(`    Median across all modes may be misleading — consider isolating each code path.`);
  }

  for (const w of warnings) output(`  ${w.level === "error" ? "✖" : "⚠"} ${w.message}`);

  return { type: "bench", name, median: med, mean: m, stddev: sd, ciLow: ci.lo, ciHigh: ci.hi, min: s[0], max: s[s.length - 1], p99, itersPerSample, samples, warnings, distribution };
}

export interface CompareRecord {
  type: "compare";
  name: string;
  baseline: Omit<BenchRecord, "type">;
  candidate: Omit<BenchRecord, "type">;
  diff: { medianDiff: number; ciLow: number; ciHigh: number; pctChange: number; significant: boolean };
  mannWhitney: { u: number; p: number; significant: boolean };
}

function makeBenchStats(name: string, samples: number[], itersPerSample: number): { record: Omit<BenchRecord, "type">; kde: KDEModeResult | null } {
  const s = sorted(samples);
  const med = median(samples);
  const m = mean(samples);
  const sd = stddev(samples);
  const ci = bootstrapCI(samples);
  const p99 = percentile(s, 99);
  const warnings = checkSamples(samples);
  const { info: distribution, kde } = computeDistribution(samples);
  return { record: { name, median: med, mean: m, stddev: sd, ciLow: ci.lo, ciHigh: ci.hi, min: s[0], max: s[s.length - 1], p99, itersPerSample, samples, warnings, distribution }, kde };
}

export function reportCompare(
  name: string,
  baselineSamples: number[], baselineIters: number,
  candidateSamples: number[], candidateIters: number,
): CompareRecord {
  const { record: b, kde: bKde } = makeBenchStats(`${name} (baseline)`, baselineSamples, baselineIters);
  const { record: c, kde: cKde } = makeBenchStats(`${name} (candidate)`, candidateSamples, candidateIters);
  const diff = bootstrapDiffCI(baselineSamples, candidateSamples);
  const mw = mannWhitneyU(baselineSamples, candidateSamples);
  const pct = b.median !== 0 ? (diff.medianDiff / b.median) * 100 : 0;

  const bLabel = baselineIters > 1 ? `  (batched: ${baselineIters} iter/sample)` : "";
  const cLabel = candidateIters > 1 ? `  (batched: ${candidateIters} iter/sample)` : "";

  output(`\ncompare: ${name}`);
  output(`  baseline:  ${formatTime(b.median)}  [${formatTime(b.ciLow)}, ${formatTime(b.ciHigh)}]  n=${baselineSamples.length}${bLabel}`);
  output(`  candidate: ${formatTime(c.median)}  [${formatTime(c.ciLow)}, ${formatTime(c.ciHigh)}]  n=${candidateSamples.length}${cLabel}`);
  if (bKde && cKde) output(renderCompareCharts(bKde, cKde));
  else if (bKde) output(renderChart(bKde));
  else if (cKde) output(renderChart(cKde));
  output(`  diff:      ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%  [${formatTime(diff.lo)}, ${formatTime(diff.hi)}] 95% CI`);
  output(`  p-value:   ${mw.p.toFixed(4)}  (Mann-Whitney U, two-sided)`);

  if (!mw.significant) {
    output(`  ⚠ Not statistically significant (p=${mw.p.toFixed(4)} ≥ 0.05)`);
  } else if (diff.medianDiff < 0) {
    output(`  ✓ Candidate is ${(-pct).toFixed(2)}% faster  (p=${mw.p.toFixed(4)})`);
  } else {
    output(`  ✖ Candidate is ${pct.toFixed(2)}% slower  (p=${mw.p.toFixed(4)})`);
  }

  for (const [label, rec] of [["baseline", b], ["candidate", c]] as const) {
    if (rec.distribution.nModes >= 2) {
      const modeStr = rec.distribution.modes
        .map(mo => `${formatTime(mo.location)} (${(mo.fraction * 100).toFixed(0)}%)`)
        .join("  /  ");
      output(`  ⚠ ${label} is multimodal (${rec.distribution.nModes} modes): ${modeStr}`);
    }
  }

  const allWarnings: Warning[] = [
    ...b.warnings.map(w => ({ ...w, message: `baseline: ${w.message}` })),
    ...c.warnings.map(w => ({ ...w, message: `candidate: ${w.message}` })),
  ];
  for (const w of allWarnings) output(`  ${w.level === "error" ? "✖" : "⚠"} ${w.message}`);

  return {
    type: "compare",
    name,
    baseline: b,
    candidate: c,
    diff: { medianDiff: diff.medianDiff, ciLow: diff.lo, ciHigh: diff.hi, pctChange: pct, significant: diff.significant },
    mannWhitney: mw,
  };
}
