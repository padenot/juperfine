// Intentionally broken benchmarks: verify that our library and hyperfine
// agree on the nature of the problem.
//
// Run with: npm run test:broken

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { collectSamples } from "../dist/runner.js";
import { median } from "../dist/stats.js";
import { checkSamples } from "../dist/warnings.js";

const DIR  = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;

function hyperfine(cmd, jsonPath, runs = 15) {
  const result = spawnSync("hyperfine", [
    "--warmup", "2",
    "--runs", String(runs),
    "--export-json", jsonPath,
    "--",
    cmd,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`hyperfine failed:\n${result.stderr}`);
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}

// ---------------------------------------------------------------------------
// Broken benchmark 1: bimodal latency
// Every 8th in-process call does 20× more work → outliers in our library.
// For hyperfine: 20% of runs are 20× slower → high stddev / outlier in times.
// ---------------------------------------------------------------------------

test("bimodal benchmark: both criterion and hyperfine flag the variance", { timeout: 120_000 }, async () => {
  const jsonPath = "/tmp/crit-ts-bimodal.json";

  // --- Our library ---
  let callCount = 0;
  const { samples } = await collectSamples(() => {
    callCount++;
    const limit = (callCount % 8 === 0) ? 2_000_000 : 100_000;
    let s = 0;
    for (let j = 0; j < limit; j++) s += j;
    return s;
  }, { warmupTime: 200, minSamples: 40, maxSamples: 120 });

  const ourWarnings = checkSamples(samples);
  const ourFlags = ourWarnings.map(w => w.message);
  const ourFlagsOutlier = ourWarnings.some(w => w.message.toLowerCase().includes("outlier"));
  const ourFlagsVariance = ourWarnings.some(w => w.message.toLowerCase().includes("variance"));

  console.log("\n[bimodal] our library warnings:");
  for (const w of ourWarnings) console.log(`  ${w.level === "error" ? "✖" : "⚠"} ${w.message}`);

  // --- hyperfine ---
  const bimodalScript = join(DIR, "fixtures", "workload-broken-bimodal.mjs");
  try {
    const data = hyperfine(`${NODE} ${bimodalScript}`, jsonPath);
    const r = data.results[0];
    // hyperfine times are in seconds; convert for display
    const times = r.times.map(t => t * 1000);
    const med = median(times);
    const hfCV = r.stddev / r.mean;
    const hfMaxRatio = Math.max(...times) / med;

    console.log(`\n[bimodal] hyperfine: mean=${(r.mean * 1000).toFixed(1)}ms  stddev=${(r.stddev * 1000).toFixed(1)}ms  CV=${(hfCV * 100).toFixed(1)}%  max/median=${hfMaxRatio.toFixed(2)}×`);
    console.log(`[bimodal] hyperfine times (ms): ${times.map(t => t.toFixed(0)).join(", ")}`);

    // Hyperfine should show a high CV or a clear outlier in times.
    const hfFlagsVariance = hfCV > 0.10;
    const hfFlagsOutlier  = hfMaxRatio > 2.0;

    console.log(`\n[bimodal] agreement:`);
    console.log(`  outlier:  criterion=${ourFlagsOutlier}  hyperfine=${hfFlagsOutlier}`);
    console.log(`  variance: criterion=${ourFlagsVariance} hyperfine=${hfFlagsVariance}`);

    assert(ourFlagsOutlier || ourFlagsVariance, `our library should warn about outliers or variance; got: ${JSON.stringify(ourFlags)}`);
    assert(hfFlagsVariance || hfFlagsOutlier,   `hyperfine should show high CV (>10%) or a max/median ratio >2×; CV=${(hfCV*100).toFixed(1)}%, ratio=${hfMaxRatio.toFixed(2)}`);
  } finally {
    try { unlinkSync(jsonPath); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Broken benchmark 2: no warmup on a JIT-sensitive function
// The function runs 150ms in a "cold" mode then becomes 10× faster.
// With warmupTime=0, early samples are slow → warmup instability warning.
// Hyperfine sees the opposite: because each run is a fresh process, all runs
// include the cold phase → it's uniformly slow, not bimodal. We verify that
// our library is uniquely able to detect this in-process warmup problem.
// ---------------------------------------------------------------------------

test("no-warmup JIT instability: criterion warns, hyperfine cannot see it", { timeout: 120_000 }, async () => {
  const jsonPath = "/tmp/crit-ts-nowarmup.json";
  const coldDurationMs = 150;

  // --- Our library with warmupTime=0 ---
  const startedAt = Date.now();
  const { samples } = await collectSamples(() => {
    const cold = Date.now() - startedAt < coldDurationMs;
    const limit = cold ? 1_000_000 : 80_000;
    let s = 0;
    for (let j = 0; j < limit; j++) s += j;
    return s;
  }, { warmupTime: 0, minSamples: 40, maxSamples: 120 });

  const ourWarnings = checkSamples(samples);
  const ourFlags = ourWarnings.map(w => w.message);
  const ourFlagsInstability = ourWarnings.some(w => w.message.toLowerCase().includes("instability"));
  const ourFlagsVariance    = ourWarnings.some(w => w.message.toLowerCase().includes("variance"));

  console.log("\n[no-warmup] our library warnings:");
  for (const w of ourWarnings) console.log(`  ${w.level === "error" ? "✖" : "⚠"} ${w.message}`);

  // --- Hyperfine: every run starts cold, so all runs are uniformly slow ---
  // hyperfine will show low variance (no within-process instability visible).
  const script = `
    const start = Date.now();
    const N = 300;
    for (let i = 0; i < N; i++) {
      const cold = Date.now() - start < 150;
      const limit = cold ? 1000000 : 80000;
      let s = 0;
      for (let j = 0; j < limit; j++) s += j;
    }
  `.replace(/\n\s+/g, " ");

  try {
    const data = hyperfine(`${NODE} -e "${script}"`, jsonPath);
    const r = data.results[0];
    const hfCV = r.stddev / r.mean;

    console.log(`\n[no-warmup] hyperfine: mean=${(r.mean * 1000).toFixed(1)}ms  CV=${(hfCV * 100).toFixed(1)}%`);
    console.log(`[no-warmup] hyperfine sees uniform slowness — CV is low because every run is equally cold`);

    console.log(`\n[no-warmup] agreement:`);
    console.log(`  instability: criterion=${ourFlagsInstability || ourFlagsVariance}  hyperfine=cannot detect (all runs equally cold)`);

    // Our library should have caught it; hyperfine by design cannot.
    assert(ourFlagsInstability || ourFlagsVariance, `our library should warn about warmup instability or variance; got: ${JSON.stringify(ourFlags)}`);
    // Hyperfine shows low CV — it measures the cold-path uniformly so it looks "stable".
    assert(hfCV < 0.20, `hyperfine CV should be low (all runs cold): CV=${(hfCV * 100).toFixed(1)}%`);
  } finally {
    try { unlinkSync(jsonPath); } catch { /* ignore */ }
  }
});
