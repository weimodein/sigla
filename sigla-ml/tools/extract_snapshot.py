"""
Snapshot extract_motion_landmarks over real clips, to prove a refactor changed
nothing.

    venv/Scripts/python.exe tools/extract_snapshot.py --out before.pkl
    ...refactor...
    venv/Scripts/python.exe tools/extract_snapshot.py --out after.pkl --compare before.pkl

Compares every clip's result exactly: the stored window must be bit-identical,
and a rejected clip must be rejected with the identical message.
"""
import argparse
import glob
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.extract import ExtractionQualityError, extract_motion_landmarks  # noqa: E402

_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_GLOB = os.path.join(_REPO, "datasets", "trimmed_clips", "*", "*", "*.mp4")


def pick(paths: list[str], limit: int) -> list[str]:
    """Spread `limit` picks evenly across the sorted list so many classes are covered."""
    paths = sorted(paths)
    if len(paths) <= limit:
        return paths
    step = len(paths) / limit
    return [paths[int(i * step)] for i in range(limit)]


def snapshot(paths: list[str]) -> dict:
    out = {}
    for p in paths:
        with open(p, "rb") as f:
            data = f.read()
        try:
            seq = extract_motion_landmarks(data, os.path.basename(p))
            out[p] = ("ok", None if seq is None else np.asarray(seq, dtype=np.float32))
        except ExtractionQualityError as e:
            out[p] = ("rejected", str(e))
    return out


def compare(before: dict, after: dict) -> int:
    diffs = 0
    for p, (kind_b, val_b) in before.items():
        kind_a, val_a = after.get(p, ("missing", None))
        same = kind_a == kind_b and (
            (val_a is None and val_b is None)
            or (isinstance(val_b, str) and val_a == val_b)
            or (isinstance(val_b, np.ndarray) and isinstance(val_a, np.ndarray)
                and val_a.shape == val_b.shape and np.array_equal(val_a, val_b))
        )
        if not same:
            diffs += 1
            print(f"DIFF {p}: before={kind_b} after={kind_a}")
    print(f"{len(before)} clips compared, {diffs} differ")
    return diffs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--glob", default=DEFAULT_GLOB)
    ap.add_argument("--limit", type=int, default=80)
    ap.add_argument("--compare")
    args = ap.parse_args()

    paths = pick(glob.glob(args.glob), args.limit)
    if not paths:
        print(f"no clips match {args.glob}")
        return 2
    snap = snapshot(paths)
    with open(args.out, "wb") as f:
        pickle.dump(snap, f)
    ok = sum(1 for k, _ in snap.values() if k == "ok")
    print(f"{len(snap)} clips: {ok} ok, {len(snap) - ok} rejected -> {args.out}")
    if args.compare:
        with open(args.compare, "rb") as f:
            return 1 if compare(pickle.load(f), snap) else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
