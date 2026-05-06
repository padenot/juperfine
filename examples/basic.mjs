// ESM usage: node examples/basic.mjs
// Or SpiderMonkey with --module: js --module --strict-benchmark-mode examples/basic.mjs
import { bench, compare, compareData, run } from "../dist/index.js";

// --- Single benchmark ---
bench("array sort 1000 elements", () => {
  const a = Array.from({ length: 1000 }, (_, i) => 1000 - i);
  a.sort((x, y) => x - y);
});

// --- Async benchmark ---
bench("async microtask", async () => {
  await Promise.resolve(42);
});

// --- In-process comparison: two implementations measured head-to-head ---
compare(
  "sum: for-loop vs reduce",
  () => { let s = 0; for (let i = 0; i < 1000; i++) s += i; return s; },
  () => Array.from({ length: 1000 }, (_, i) => i).reduce((a, b) => a + b, 0),
);

// --- Out-of-process comparison: load samples saved from two separate runs ---
// Typical workflow:
//   js --strict-benchmark-mode bench-baseline.mjs  --json-output=baseline.json
//   js --strict-benchmark-mode bench-patched.mjs   --json-output=patched.json
//   node compare.mjs
//
// Then in compare.mjs:
//   import { readFileSync } from "node:fs";
//   const baseline = JSON.parse(readFileSync("baseline.json", "utf8"));
//   const patched  = JSON.parse(readFileSync("patched.json",  "utf8"));
//   compareData("my optimization", baseline[0].samples, patched[0].samples);
//
// For illustration, we just use synthetic data here:
const syntheticBaseline  = Array.from({ length: 50 }, () => 10 + Math.random() * 2);
const syntheticCandidate = Array.from({ length: 50 }, () => 8.5 + Math.random() * 2);
compareData("synthetic: baseline vs candidate", syntheticBaseline, syntheticCandidate);

await run({ jsonOutput: "results.json" });
