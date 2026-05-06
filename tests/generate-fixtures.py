# /// script
# dependencies = ["numpy", "scipy"]
# ///
# Generates expected values for cross-checking stats.ts against scipy.
# Run with: uv run tests/generate-fixtures.py

import json
import numpy as np
from scipy import stats


def mw(a, b):
    stat, p = stats.mannwhitneyu(a, b, alternative="two-sided")
    return {"u": float(stat), "p": float(p), "significant": p < 0.05}


def bootstrap_diff_ci(base, new_data, n_iter=1000, alpha=0.05, seed=42):
    rng = np.random.default_rng(seed)
    diffs = np.array([
        np.median(rng.choice(new_data, size=len(new_data), replace=True)) -
        np.median(rng.choice(base,     size=len(base),     replace=True))
        for _ in range(n_iter)
    ])
    diffs.sort()
    lo = diffs[int((alpha / 2) * n_iter)]
    hi = diffs[min(int((1 - alpha / 2) * n_iter), n_iter - 1)]
    return {
        "medianDiff": float(np.median(new_data) - np.median(base)),
        "lo": float(lo),
        "hi": float(hi),
        "significant": int(lo > 0 or hi < 0) == 1,
    }


def bootstrap_ci(data, n_iter=1000, alpha=0.05, seed=42):
    rng = np.random.default_rng(seed)
    medians = np.array([
        np.median(rng.choice(data, size=len(data), replace=True))
        for _ in range(n_iter)
    ])
    medians.sort()
    lo = medians[int((alpha / 2) * n_iter)]
    hi = medians[min(int((1 - alpha / 2) * n_iter), n_iter - 1)]
    return {"lo": float(lo), "hi": float(hi)}


cases = {
    "mannWhitney": [
        {
            "label": "clearly separated",
            "a": [1, 2, 3, 4, 5],
            "b": [6, 7, 8, 9, 10],
            "expected": mw([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]),
        },
        {
            "label": "no difference",
            "a": [1, 2, 3, 4, 5],
            "b": [1, 2, 3, 4, 5],
            "expected": mw([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]),
        },
        {
            "label": "partial overlap",
            "a": [10, 20, 30, 40, 50, 60],
            "b": [25, 35, 45, 55, 65, 75],
            "expected": mw([10, 20, 30, 40, 50, 60], [25, 35, 45, 55, 65, 75]),
        },
        {
            "label": "ties present",
            "a": [1, 1, 2, 2, 3],
            "b": [2, 2, 3, 3, 4],
            "expected": mw([1, 1, 2, 2, 3], [2, 2, 3, 3, 4]),
        },
        {
            "label": "larger samples",
            "a": list(range(1, 21)),
            "b": list(range(11, 31)),
            "expected": mw(list(range(1, 21)), list(range(11, 31))),
        },
    ],
    "bootstrapDiffCI": [
        {
            "label": "candidate faster",
            "base":    [10.0, 10.1, 9.9, 10.2, 9.8, 10.0, 10.1, 9.9, 10.0, 10.1],
            "newData": [8.0,  8.1,  7.9, 8.2,  7.8, 8.0,  8.1,  7.9, 8.0,  8.1],
            "expected": bootstrap_diff_ci(
                [10.0, 10.1, 9.9, 10.2, 9.8, 10.0, 10.1, 9.9, 10.0, 10.1],
                [8.0,  8.1,  7.9, 8.2,  7.8, 8.0,  8.1,  7.9, 8.0,  8.1],
            ),
        },
        {
            "label": "no difference",
            "base":    [5.0, 5.1, 4.9, 5.0, 5.2, 4.8, 5.0, 5.1, 4.9, 5.0],
            "newData": [5.0, 5.1, 4.9, 5.0, 5.2, 4.8, 5.0, 5.1, 4.9, 5.0],
            "expected": bootstrap_diff_ci(
                [5.0, 5.1, 4.9, 5.0, 5.2, 4.8, 5.0, 5.1, 4.9, 5.0],
                [5.0, 5.1, 4.9, 5.0, 5.2, 4.8, 5.0, 5.1, 4.9, 5.0],
            ),
        },
    ],
    "bootstrapCI": [
        {
            "label": "tight cluster",
            "data": [10.0, 10.1, 9.9, 10.2, 9.8, 10.0, 10.1, 9.9, 10.0, 10.1,
                     10.0, 10.1, 9.9, 10.2, 9.8, 10.0, 10.1, 9.9, 10.0, 10.1],
            "expected": bootstrap_ci(
                [10.0, 10.1, 9.9, 10.2, 9.8, 10.0, 10.1, 9.9, 10.0, 10.1,
                 10.0, 10.1, 9.9, 10.2, 9.8, 10.0, 10.1, 9.9, 10.0, 10.1],
            ),
        },
    ],
}

class Encoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return float(o)
        if isinstance(o, (np.bool_,)):
            return bool(o)
        return super().default(o)

print(json.dumps(cases, indent=2, cls=Encoder))
