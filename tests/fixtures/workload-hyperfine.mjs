// Standalone script measured by hyperfine.
// Runs the workload N times (argv[2]) so startup overhead is a small fraction
// of total time. Keep this in sync with the function inside hyperfine.test.mjs.
const N = parseInt(process.argv[2] ?? "500", 10);
for (let i = 0; i < N; i++) {
  // Fisher-Yates shuffle + sort on 1000 elements.
  const arr = Array.from({ length: 1000 }, (_, j) => j);
  for (let j = 999; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    const tmp = arr[j]; arr[j] = arr[k]; arr[k] = tmp;
  }
  arr.sort((a, b) => a - b);
}
