// SpiderMonkey shell:
//   js --module --strict-benchmark-mode examples/spidermonkey.js
//
// Requires the bundle: npm run build:bundle
import { bench, compare, compareData, run } from "../dist/juperfine.js";

bench("string concat", () => {
  let s = "";
  for (let i = 0; i < 100; i++) s += "x";
  return s;
});

bench("array push 1000", () => {
  const a = [];
  for (let i = 0; i < 1000; i++) a.push(i);
  return a;
});

compare(
  "property access: obj vs Map",
  () => { const o = { x: 1 }; return o.x; },
  () => { const m = new Map([["x", 1]]); return m.get("x"); },
);

run().then(() => {});
