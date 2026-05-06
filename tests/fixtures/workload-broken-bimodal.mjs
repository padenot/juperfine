// For hyperfine cross-check in broken.test.mjs.
// Each process invocation is randomly fast or slow (20% chance of slow),
// producing a bimodal distribution across hyperfine runs.
const N = 300;
const slow = Math.random() < 0.20;
const innerLimit = slow ? 2_000_000 : 100_000;
for (let i = 0; i < N; i++) {
  let s = 0;
  for (let j = 0; j < innerLimit; j++) s += j;
}
