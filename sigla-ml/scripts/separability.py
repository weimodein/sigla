"""
Separability check — predict whether classes will train well, before training.

Measures, over normalized 30x147 sequences:

    within-class spread     how far two takes of the SAME sign sit apart
    between-class distance  how far two DIFFERENT signs sit apart

The ratio `between / within` is the number to read. Above ~1.0 a model can
separate the classes; below it they physically overlap in feature space and
re-recording is the only fix. See artifacts/device_tests/separability_method.md
for the track record that calibrates those thresholds.

This was inline in a session originally. It is a file now because adding the
alphabet means running it repeatedly as letters arrive, rather than once.

Usage:

    # every category, the original whole-dataset view
    python scripts/separability.py

    # one category's pairs, worst first
    python scripts/separability.py --category FAMILY

    # the question the alphabet raises: does a letter collide with the day
    # sign built from it? Pairs are checked ACROSS the two groups.
    python scripts/separability.py --pairs M:MONDAY T:TUESDAY W:WEDNESDAY

    # same thing, but let the labels decide: every A-Z label against every
    # non-letter label, reporting only collisions under the threshold
    python scripts/separability.py --letters-vs-words --threshold 1.0

Needs the backend running, since it reads through fetch_approved_samples().
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.utils.preprocessor import fetch_approved_samples, normalize_sequence  # noqa: E402


# Ratios below this get flagged. 1.0 is where between-class distance stops
# exceeding within-class spread; the method doc's failures (MONTHS at 0.38,
# SON/DAUGHTER at 0.33) sit well under it and NUMBERS trained fine at 1.15.
DEFAULT_THRESHOLD = 1.0

# label -> set of session_ids that recorded it, filled by load_vectors.
#
# Within-class spread includes inter-signer variation, so a class recorded by
# FEWER signers has a smaller denominator and its ratios read optimistically.
# Comparing a 3-signer letter against a 4-signer day sign is still informative
# (a failure under optimistic conditions is a real failure), but a marginal
# pass is not — hence the warning the report prints when coverage differs.
SIGNERS: dict[str, set] = {}


def _flatten(sample) -> np.ndarray:
    """One sample -> one vector, so distance is a plain Euclidean norm.

    fetch_approved_samples returns the backend's JSON unchanged, so a sample is
    a dict carrying the 30x147 array under "sequence" alongside its id and
    session. A bare array is accepted too, for callers holding sequences
    already.

    Normalizing first matters and is not optional: raw sequences carry the
    signer's position in frame, so two takes of one sign recorded a step apart
    look further apart than two different signs recorded in the same spot.
    """
    seq = sample["sequence"] if isinstance(sample, dict) else sample
    return normalize_sequence(np.asarray(seq, dtype=np.float32)).ravel()


def _mean_pairwise(vectors: list[np.ndarray]) -> float:
    """Mean distance between every distinct pair. 0.0 when there is no pair."""
    if len(vectors) < 2:
        return 0.0
    dists = [
        float(np.linalg.norm(a - b))
        for a, b in itertools.combinations(vectors, 2)
    ]
    return float(np.mean(dists))


def _mean_cross(a: list[np.ndarray], b: list[np.ndarray]) -> float:
    """Mean distance between every a-b pairing."""
    if not a or not b:
        return 0.0
    dists = [float(np.linalg.norm(x - y)) for x in a for y in b]
    return float(np.mean(dists))


def load_vectors(labels: list[str] | None = None) -> dict[str, list[np.ndarray]]:
    """Fetch approved samples and flatten them, optionally keeping only `labels`."""
    raw = fetch_approved_samples()
    wanted = set(labels) if labels else None
    out: dict[str, list[np.ndarray]] = {}
    SIGNERS.clear()
    for label, samples in raw.items():
        if wanted is not None and label not in wanted:
            continue
        vecs = [_flatten(s) for s in samples]
        if vecs:
            out[label] = vecs
            SIGNERS[label] = {
                s.get("session_id") for s in samples if isinstance(s, dict)
            }
    return out


def pair_ratio(vectors: dict[str, list[np.ndarray]], a: str, b: str) -> dict | None:
    """between/within for exactly two classes.

    `within` averages the two classes' own spreads, so the ratio is not skewed
    by whichever class happens to be recorded more tightly.
    """
    if a not in vectors or b not in vectors:
        return None
    within_a = _mean_pairwise(vectors[a])
    within_b = _mean_pairwise(vectors[b])
    within = (within_a + within_b) / 2.0
    between = _mean_cross(vectors[a], vectors[b])
    if within <= 0:
        return None
    return {
        "pair": [a, b],
        "ratio": round(between / within, 2),
        "within_class_spread": round(within, 1),
        "between_class_distance": round(between, 1),
        "n_samples": [len(vectors[a]), len(vectors[b])],
        "n_signers": [len(SIGNERS.get(a, ())), len(SIGNERS.get(b, ()))],
    }


def group_summary(vectors: dict[str, list[np.ndarray]], labels: list[str]) -> dict:
    """Category-level within/between, matching the shape stored in the JSON artifact.

    The method doc's warning applies: a healthy category mean can hide a bad
    pair (FAMILY averaged 1.14 while SON/DAUGHTER sat at 0.33), so callers
    should read `pairs` too, not just this.
    """
    present = [l for l in labels if l in vectors]
    if len(present) < 2:
        return {}
    within = float(np.mean([_mean_pairwise(vectors[l]) for l in present]))
    between = float(np.mean([
        _mean_cross(vectors[a], vectors[b])
        for a, b in itertools.combinations(present, 2)
    ]))
    if within <= 0:
        return {}
    return {
        "labels": present,
        "within_class_spread": round(within, 1),
        "between_class_distance": round(between, 1),
        "ratio": round(between / within, 2),
    }


def _verdict(ratio: float, threshold: float) -> str:
    if ratio >= threshold + 0.15:
        return "ok"
    if ratio >= threshold:
        return "marginal"
    return "COLLIDES"


def _print_pairs(rows: list[dict], threshold: float) -> None:
    if not rows:
        print("no pairs to report (labels missing from the dataset?)")
        return
    rows = sorted(rows, key=lambda r: r["ratio"])
    width = max(len(f"{r['pair'][0]} vs {r['pair'][1]}") for r in rows)
    print(f"{'pair'.ljust(width)}   ratio  n        signers  verdict")
    print("-" * (width + 35))
    lopsided = False
    for r in rows:
        name = f"{r['pair'][0]} vs {r['pair'][1]}".ljust(width)
        n = f"{r['n_samples'][0]}/{r['n_samples'][1]}".ljust(7)
        sa, sb = r.get("n_signers", [0, 0])
        sig = f"{sa}/{sb}".ljust(7)
        if sa and sb and sa != sb:
            lopsided = True
        print(f"{name}   {r['ratio']:<6.2f} {n}  {sig}  "
              f"{_verdict(r['ratio'], threshold)}")

    if lopsided:
        print()
        print("note: some pairs above mix classes recorded by different numbers")
        print("      of signers. The class with fewer carries less")
        print("      inter-signer variation in its within-class spread, which")
        print("      inflates the ratio — so read a marginal pass as a warning,")
        print("      while a failure stands regardless.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--category", help="report every pair within one category's labels")
    ap.add_argument("--labels", nargs="+",
                    help="explicit label list for --category-style pair reporting")
    ap.add_argument("--pairs", nargs="+", metavar="A:B",
                    help="check specific pairs, e.g. M:MONDAY T:TUESDAY")
    ap.add_argument("--letters-vs-words", action="store_true",
                    help="every single-character label against every multi-character one")
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                    help=f"flag ratios below this (default {DEFAULT_THRESHOLD})")
    ap.add_argument("--json", metavar="PATH", help="also write results as JSON")
    args = ap.parse_args()

    if args.pairs:
        wanted: list[str] = []
        for p in args.pairs:
            if ":" not in p:
                ap.error(f"--pairs expects A:B, got {p!r}")
            wanted.extend(p.split(":", 1))
        vectors = load_vectors(wanted)
        rows = []
        for p in args.pairs:
            a, b = p.split(":", 1)
            r = pair_ratio(vectors, a, b)
            if r is None:
                missing = [x for x in (a, b) if x not in vectors]
                print(f"skipped {a} vs {b}: no samples for {', '.join(missing)}")
                continue
            rows.append(r)
        _print_pairs(rows, args.threshold)
        result = {"pairs": rows}

    elif args.letters_vs_words:
        vectors = load_vectors()
        letters = sorted(l for l in vectors if len(l) == 1 and l.isalpha())
        words = sorted(l for l in vectors if len(l) > 1)
        if not letters:
            print("no single-character labels in the dataset yet — nothing to compare.")
            print("Record a few letters first, then re-run.")
            return 1
        rows = []
        for a in letters:
            for b in words:
                r = pair_ratio(vectors, a, b)
                if r and r["ratio"] < args.threshold:
                    rows.append(r)
        if not rows:
            print(f"no letter/word pair fell below {args.threshold} — "
                  f"checked {len(letters)} letters against {len(words)} words.")
        else:
            _print_pairs(rows, args.threshold)
        result = {"pairs": rows, "letters": letters, "n_words": len(words)}

    else:
        labels = args.labels
        if args.category and not labels:
            ap.error("--category needs --labels (the dataset has no category field here)")
        vectors = load_vectors(labels)
        if labels:
            rows = []
            for a, b in itertools.combinations([l for l in labels if l in vectors], 2):
                r = pair_ratio(vectors, a, b)
                if r:
                    rows.append(r)
            summary = group_summary(vectors, labels)
            if summary:
                print(f"category ratio: {summary['ratio']}  "
                      f"(within {summary['within_class_spread']}, "
                      f"between {summary['between_class_distance']})")
                print()
            _print_pairs(rows, args.threshold)
            result = {"summary": summary, "pairs": rows}
        else:
            all_labels = sorted(vectors)
            rows = []
            for a, b in itertools.combinations(all_labels, 2):
                r = pair_ratio(vectors, a, b)
                if r and r["ratio"] < args.threshold:
                    rows.append(r)
            print(f"{len(all_labels)} labels; "
                  f"{len(rows)} pairs below {args.threshold}\n")
            _print_pairs(rows, args.threshold)
            result = {"pairs": rows, "labels": all_labels}

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=2)
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
