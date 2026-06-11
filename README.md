# juperfine

Adaptive statistical benchmarking for JavaScript and TypeScript, in the spirit
of [hyperfine](https://github.com/sharkdp/hyperfine) (Rust) and
[criterion](https://hackage.haskell.org/package/criterion) (Haskell). Runs long
enough to get reliable results and warns when something looks wrong.

Works in Node.js and SpiderMonkey (`js --module --strict-benchmark-mode`).

## Install

**Node.js**: copy the `dist/` directory and import from `./dist/index.js`.

**SpiderMonkey**: build the single-file bundle with `npm run build:bundle`, then copy `dist/juperfine.js` and import it:

```js
import { bench, compare, run } from "./juperfine.js";
```

## Usage

```js
import { bench, compare, run } from "juperfine";

bench("sort 1000 elements", () => {
  const a = Array.from({ length: 1000 }, () => Math.random());
  a.sort((x, y) => x - y);
});

compare(
  "dedup: indexOf vs Set",
  () => { /* baseline */ },
  () => { /* candidate */ },
);

await run();
```

```
compare: synthetic: baseline vs candidate
  baseline:  11.193 ms  [10.836 ms, 11.508 ms]  n=50
  candidate: 9.600 ms  [9.435 ms, 9.789 ms]  n=50
                                                                          ██▂
                                                      ▃                  ▄███▁▁
                                       ▃      ▃       ██                 ██████
                                      ▇█   ▁ ▇█▁     ▂██          ▃▂    ▅██████▃
                                      ███ ██████   ▁ ███   ▁  ▅▃ ▅██▄   ████████
                                      ███ ██████▂ ██▃███  ▅██▄██▁████▄▂▃████████
                                     ▂███▆██████████████▆▇██████████████████████▆
                                    ▁████████████████████████████████████████████▁
                         ▃  ▁           ▅█
                        ▂█  █           ██
                    ▃ ▃ ██ ▇█           ████
                   ▆███▃██▅██▇ ▅▂       ████▅
    ▂ ▄▄       ▇▇  ███████████ ██       █████
    █▄██▇      ██▅▆███████████▅██ ▄▄  ▅▆█████
   ▇█████▂     ██████████████████▇██ ▃███████
   ███████    ▄█████████████████████▂█████████
  8.457 ms                                                                12.117 ms
  diff:      -14.23%  [-1934748.074 ns, -1181926.556 ns] 95% CI
  p-value:   0.0000  (Mann-Whitney U, two-sided)
  ✓ Candidate is 14.23% faster  (p=0.0000)
  ⚠ baseline is multimodal (7 modes): 10.143 ms (10%)  /  10.461 ms (18%)  /  10.841 ms (14%)  /  11.066 ms (6%)  /  11.198 ms (6%)  /  11.386 ms (12%)  /  11.764 ms (34%)
  ⚠ candidate is multimodal (8 modes): 8.574 ms (6%)  /  8.690 ms (8%)  /  9.281 ms (14%)  /  9.372 ms (10%)  /  9.510 ms (12%)  /  9.648 ms (12%)  /  9.804 ms (10%)  /  10.226 ms (28%)
  ⚠ baseline: High variance (CV=5.6%) — consider reducing system load or increasing warmupTime.
  ⚠ candidate: High variance (CV=5.7%) — consider reducing system load or increasing warmupTime.
```

Output includes median, 95% bootstrap CI, a KDE density chart, and warnings for high variance, outliers, timer resolution issues, and warmup instability.

For out-of-process comparisons (e.g. two separate SpiderMonkey runs), save results with `run({ jsonOutput: "results.json" })` then use `compareData(name, baseline[0].samples, candidate[0].samples)`.

See `examples/` for more.

## API

```ts
bench(name, fn, opts?)          // register a single benchmark
compare(name, base, cand, opts?) // register an in-process comparison
compareData(name, base, cand)    // compare pre-collected sample arrays
run(opts?)                       // execute all registered benchmarks
shouldStop(samples, opts?)       // adaptive stopping for out-of-process collection
```

`opts` controls `warmupTime` (ms, default 500), `minSamples` (default 30), `maxSamples` (default 300), and `targetPrecision` (default 0.01).

### Out-of-process adaptive sampling with `shouldStop`

When the benchmark runs in a separate process (e.g. a browser driven via
WebDriver), use `shouldStop` to decide when you have enough samples instead of
collecting a fixed count:

```js
import { shouldStop, compareData, run } from "juperfine";

const samples = [];
while (!shouldStop(samples)) {
  const score = await runBenchmarkOnce();   // your external benchmark
  samples.push(1 / score);                  // invert if higher-is-better
}
// then compareData(...) as usual
```

`shouldStop(samples, opts?)` returns `true` when `stddev / sqrt(n) / mean <=
targetPrecision` (same criterion as `collectSamples` internally), subject to
`minSamples` (default 10) and `maxSamples` (default 100).

## Warnings

| Warning | Meaning |
|---|---|
| High variance (CV > 5%) | Results are noisy |
| Severe outliers | Tukey 3×IQR fence exceeded |
| Timer resolution | >50% of samples are identical |
| Warmup instability | Early samples differ from steady state |
| Multimodal distribution | KDE detects multiple peaks |

## License

[MPL-2.0](LICENSE)
