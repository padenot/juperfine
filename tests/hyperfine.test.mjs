// Integration test: cross-check our per-iteration timing against hyperfine.
//
// Strategy:
//   1. Run an empty Node.js script with hyperfine → measures startup overhead.
//   2. Run our workload script (N iterations) with hyperfine → measures startup + N*work.
//   3. Estimate per-iteration time = (workload_mean - startup_mean) / N.
//      With N=500 and ~1ms/iter, startup (~50ms) is <10% of total, so the
//      subtraction noise is small.
//   4. Run the same workload function with our library → measures steady-state.
//   5. Assert both are within 2× of each other.
//
// Our library measures JIT-compiled steady-state; hyperfine's estimate includes
// amortised warmup overhead, so they won't be identical. 2× covers that gap.
//
// Run with: npm run test:hyperfine

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { collectSamples } from "../dist/runner.js";
import { median } from "../dist/stats.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const WORKLOAD = join(DIR, "fixtures", "workload-hyperfine.mjs");
const NODE = process.execPath;
const N_ITERS = 500;

function hyperfine(cmd, jsonPath) {
  const result = spawnSync("hyperfine", [
    "--warmup", "3",
    "--runs", "10",
    "--time-unit", "millisecond",
    "--export-json", jsonPath,
    "--",
    cmd,
  ], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`hyperfine failed:\n${result.stderr}`);
  }
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}

// Keep in sync with tests/fixtures/workload-hyperfine.mjs.
function workload() {
  const arr = Array.from({ length: 1000 }, (_, j) => j);
  for (let j = 999; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    const tmp = arr[j]; arr[j] = arr[k]; arr[k] = tmp;
  }
  arr.sort((a, b) => a - b);
}

test("per-iteration timing agrees with hyperfine within 2×", { timeout: 180_000 }, async () => {
  const startupJson = "/tmp/crit-ts-startup.json";
  const workloadJson = "/tmp/crit-ts-workload.json";

  try {
    const startupData = hyperfine(`${NODE} --input-type=module -e ''`, startupJson);
    const workloadData = hyperfine(`${NODE} ${WORKLOAD} ${N_ITERS}`, workloadJson);

    // hyperfine JSON always exports in seconds regardless of --time-unit.
    const startupSec = startupData.results[0].mean;
    const totalSec   = workloadData.results[0].mean;
    // Convert to ms to match our library's output unit.
    const startupMs  = startupSec  * 1000;
    const totalMs    = totalSec    * 1000;
    const hyperfinePerIterMs = (totalMs - startupMs) / N_ITERS;

    const { samples } = await collectSamples(workload, { warmupTime: 500, minSamples: 50 });
    const ourMedianMs = median(samples);

    console.log(`\n  hyperfine: ${(hyperfinePerIterMs * 1000).toFixed(3)} µs/iter  (total=${totalMs.toFixed(1)}ms, startup=${startupMs.toFixed(1)}ms, N=${N_ITERS})`);
    console.log(`  criterion: ${(ourMedianMs * 1000).toFixed(3)} µs/iter  (${samples.length} samples)`);
    console.log(`  ratio criterion/hyperfine: ${(ourMedianMs / hyperfinePerIterMs).toFixed(3)}`);

    assert(
      hyperfinePerIterMs > 0,
      `startup subtraction produced non-positive per-iter time: ${hyperfinePerIterMs}ms — try increasing N_ITERS`,
    );

    const ratio = ourMedianMs / hyperfinePerIterMs;
    assert(
      ratio > 0.3 && ratio < 3.0,
      `timing ratio out of expected range [0.3, 3.0]: criterion=${ourMedianMs.toFixed(4)}ms, hyperfine=${hyperfinePerIterMs.toFixed(4)}ms, ratio=${ratio.toFixed(3)}`,
    );
  } finally {
    for (const p of [startupJson, workloadJson]) {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }
});
