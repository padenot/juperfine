import { mean, stddev, detectOutliers, sorted } from "./stats.js";

export interface Warning {
  level: "warn" | "error";
  message: string;
}

export function checkSamples(samples: number[]): Warning[] {
  const warnings: Warning[] = [];
  const n = samples.length;
  const m = mean(samples);
  const cv = stddev(samples) / m;

  if (cv > 0.2) {
    warnings.push({
      level: "error",
      message: `Very high variance (CV=${(cv * 100).toFixed(1)}%) — results are unreliable. Check for background load or disable CPU frequency scaling.`,
    });
  } else if (cv > 0.05) {
    warnings.push({
      level: "warn",
      message: `High variance (CV=${(cv * 100).toFixed(1)}%) — consider reducing system load or increasing warmupTime.`,
    });
  }

  const { mild, severe } = detectOutliers(samples);
  if (severe > 0) {
    warnings.push({ level: "error", message: `${severe} severe outlier(s) detected — results may be skewed.` });
  } else if (mild > 0) {
    warnings.push({ level: "warn", message: `${mild} mild outlier(s) (${(mild / n * 100).toFixed(1)}% of samples).` });
  }

  // Flag low timer resolution: fewer than half the samples are distinct values.
  const s = sorted(samples);
  let distinct = 1;
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) distinct++;
  if (distinct < n * 0.5) {
    warnings.push({
      level: "warn",
      message: `Low timer resolution (${distinct} distinct values in ${n} samples) — consider increasing itersPerSample via calibration or using performance.now().`,
    });
  }

  // Warmup instability: if the earliest 10% of samples differ from the rest by > 10%.
  const split = Math.max(Math.ceil(n * 0.1), 3);
  if (n > split * 3) {
    const earlyMean = mean(samples.slice(0, split));
    const lateMean = mean(samples.slice(split));
    const drift = (earlyMean - lateMean) / lateMean;
    if (Math.abs(drift) > 0.1) {
      const dir = drift > 0 ? "slower" : "faster";
      warnings.push({
        level: "warn",
        message: `Warmup instability — early samples are ${(Math.abs(drift) * 100).toFixed(0)}% ${dir} than steady state. Consider increasing warmupTime.`,
      });
    }
  }

  return warnings;
}
