import { collectSamples, type BenchFn, type SampleOptions } from "./runner.js";
import { mean, stddev } from "./stats.js";
import { reportBench, reportCompare, output, type BenchRecord, type CompareRecord } from "./reporter.js";

interface BenchEntry {
  kind: "bench";
  name: string;
  fn: BenchFn;
  opts?: SampleOptions;
}

interface CompareEntry {
  kind: "compare";
  name: string;
  baseline: BenchFn;
  candidate: BenchFn;
  opts?: SampleOptions;
}

interface DataEntry {
  kind: "data";
  name: string;
  baseline: number[];
  candidate: number[];
}

type Entry = BenchEntry | CompareEntry | DataEntry;

const registry: Entry[] = [];

export function bench(name: string, fn: BenchFn, opts?: SampleOptions): void {
  registry.push({ kind: "bench", name, fn, opts });
}

// In-process comparison: runs both functions and compares their distributions.
export function compare(name: string, baseline: BenchFn, candidate: BenchFn, opts?: SampleOptions): void {
  registry.push({ kind: "compare", name, baseline, candidate, opts });
}

// Out-of-process comparison: compare two pre-collected sample arrays (e.g. loaded from JSON).
// Samples should be per-iteration times in ms, as produced by a prior bench() run's .samples field.
export function compareData(name: string, baseline: number[], candidate: number[]): void {
  registry.push({ kind: "data", name, baseline, candidate });
}

export interface RunOptions {
  // File path to write JSON results. Uses SpiderMonkey write() or Node.js fs as available.
  jsonOutput?: string;
}

export async function run(opts?: RunOptions): Promise<(BenchRecord | CompareRecord)[]> {
  const results: (BenchRecord | CompareRecord)[] = [];

  for (const entry of registry) {
    if (entry.kind === "bench") {
      const { samples, itersPerSample } = await collectSamples(entry.fn, entry.opts);
      results.push(reportBench(entry.name, samples, itersPerSample));
    } else if (entry.kind === "compare") {
      const b = await collectSamples(entry.baseline, entry.opts);
      const c = await collectSamples(entry.candidate, entry.opts);
      results.push(reportCompare(entry.name, b.samples, b.itersPerSample, c.samples, c.itersPerSample));
    } else {
      results.push(reportCompare(entry.name, entry.baseline, 1, entry.candidate, 1));
    }
  }

  if (opts?.jsonOutput) {
    const json = JSON.stringify(results, null, 2);
    if (!writeSync(opts.jsonOutput, json)) {
      try {
        const fs = await import("node:fs/promises");
        await fs.writeFile(opts.jsonOutput, json, "utf8");
      } catch {
        output(`\n--- JSON OUTPUT ---\n${json}`);
      }
    }
  }

  return results;
}

function writeSync(path: string, content: string): boolean {
  try {
    const g = globalThis as Record<string, unknown>;
    if (typeof g["write"] === "function") {
      (g["write"] as (p: string, c: string) => void)(path, content);
      return true;
    }
    const os = g["os"] as { file?: { writeTypedArrayToFile?: (p: string, d: Uint8Array) => void } } | undefined;
    if (os?.file?.writeTypedArrayToFile) {
      os.file.writeTypedArrayToFile(path, new TextEncoder().encode(content));
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

// Check whether an externally-collected sample array has reached the same
// precision target used internally by collectSamples(). Call after each new
// sample to decide when to stop collecting from an out-of-process benchmark.
export function shouldStop(
  samples: number[],
  opts: { minSamples?: number; maxSamples?: number; targetPrecision?: number } = {},
): boolean {
  const { minSamples = 10, maxSamples = 100, targetPrecision = 0.01 } = opts;
  if (samples.length >= maxSamples) return true;
  if (samples.length < minSamples) return false;
  const m = mean(samples);
  if (m <= 0) return false;
  return stddev(samples) / Math.sqrt(samples.length) / m <= targetPrecision;
}

export type { BenchFn, SampleOptions, BenchRecord, CompareRecord };
