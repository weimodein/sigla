"""
Find duplicate and cross-labelled gesture samples in the training set.

WHY THIS EXISTS
---------------
The KNOW class sat at 50.3% recall with every single error landing on DON'T
UNDERSTAND, bit-identical across four architectures (lstm, bilstm_half,
bilstm_full, mirror). A result that stable across different models is not a
modelling failure -- it means the training data asserts two different labels for
the same input.

Hashing every stored sequence confirmed it: 21 sequences are filed under BOTH
KNOW and DON'T UNDERSTAND, byte-identical. The model cannot separate classes that
share vectors, so no architecture change could ever have fixed this.

Migration 002's comment guessed the KNOW recall came from a single signer
performing the sign differently. That hypothesis is now disproven -- the rows are
literal duplicates, not stylistic variants.

WHAT IT REPORTS
---------------
1. Cross-label collisions -- the same sequence stored under two different words.
   These are label errors and they cap accuracy directly.
2. Within-label duplicates -- the same sequence stored twice under one word.
   These do not corrupt labels, but they inflate the dataset and leak identical
   rows across cross-validation folds, so the reported accuracy is optimistic.

Read-only. Use `dedupe_samples.py` to act on what this finds.

USAGE
    venv/Scripts/python.exe tools/audit_duplicates.py
    venv/Scripts/python.exe tools/audit_duplicates.py --json audit.json
    venv/Scripts/python.exe tools/audit_duplicates.py --cache ds.json   # reuse a fetch
"""

import argparse
import hashlib
import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.preprocessor import fetch_approved_samples  # noqa: E402


def normalize_label(label: str) -> str:
    """Curly and straight apostrophes both occur in the word list."""
    return label.replace("’", "'").strip().upper()


def sequence_hash(sequence) -> str:
    """
    Stable content hash of one 30x147 sequence.

    float32 because that is the dtype training uses -- hashing the raw JSON text
    would make formatting differences (trailing zeros, exponent form) look like
    different data.
    """
    return hashlib.sha1(
        np.asarray(sequence, dtype=np.float32).tobytes()
    ).hexdigest()


def build_index(dataset: dict) -> dict:
    """hash -> [(label, sample_id, file_url), ...] for every stored sample."""
    index = defaultdict(list)
    for label, samples in dataset.items():
        norm = normalize_label(label)
        for sample in samples:
            index[sequence_hash(sample["sequence"])].append(
                (norm, sample["sample_id"], sample.get("file_url"))
            )
    return index


def analyze(dataset: dict) -> dict:
    index = build_index(dataset)
    total = sum(len(v) for v in dataset.values())

    cross, within = [], []
    for digest, entries in index.items():
        if len(entries) < 2:
            continue
        labels = {label for label, _, _ in entries}
        record = {
            "hash": digest[:16],
            "labels": sorted(labels),
            "samples": [
                {"label": lb, "sample_id": sid, "file_url": url}
                for lb, sid, url in sorted(entries, key=lambda e: e[1])
            ],
        }
        (cross if len(labels) > 1 else within).append(record)

    cross.sort(key=lambda r: r["samples"][0]["sample_id"])
    within.sort(key=lambda r: r["samples"][0]["sample_id"])

    per_class = {}
    for label, samples in dataset.items():
        hashes = [sequence_hash(s["sequence"]) for s in samples]
        foreign = sum(
            1 for h in hashes if len({lb for lb, _, _ in index[h]}) > 1
        )
        per_class[normalize_label(label)] = {
            "samples": len(samples),
            "unique": len(set(hashes)),
            "duplicated": len(samples) - len(set(hashes)),
            "cross_labelled": foreign,
        }

    return {
        "total_samples": total,
        "unique_sequences": len(index),
        "redundant_rows": total - len(index),
        "cross_label_collisions": cross,
        "within_label_duplicates": within,
        "per_class": per_class,
    }


def report(result: dict) -> None:
    total = result["total_samples"]
    uniq = result["unique_sequences"]
    redundant = result["redundant_rows"]

    print(f"samples             {total}")
    print(f"unique sequences    {uniq}")
    pct = (100.0 * redundant / total) if total else 0.0
    print(f"redundant rows      {redundant} ({pct:.1f}%)")

    cross = result["cross_label_collisions"]
    print(f"\n=== CROSS-LABEL COLLISIONS ({len(cross)} sequences) ===")
    if not cross:
        print("  none -- no sequence is stored under two different words.")
    else:
        print("  The same sequence is stored under two different words. One of the")
        print("  two labels is wrong; the model is being trained to contradict itself.\n")
        by_pair = defaultdict(list)
        for record in cross:
            by_pair[" | ".join(record["labels"])].append(record)
        for pair, records in sorted(by_pair.items(), key=lambda kv: -len(kv[1])):
            print(f"  {len(records)} sequences under: {pair}")
            per_label = defaultdict(list)
            for record in records:
                for s in record["samples"]:
                    per_label[s["label"]].append(s["sample_id"])
            for label, ids in sorted(per_label.items()):
                ids.sort()
                print(f"      {label:20s} n={len(ids):3d}  sample_ids {ids[0]}..{ids[-1]}")
            print()

    within = result["within_label_duplicates"]
    print(f"=== WITHIN-LABEL DUPLICATES ({len(within)} sequences) ===")
    if not within:
        print("  none")
    else:
        print("  Same sequence stored more than once under ONE word. Labels are")
        print("  consistent, but identical rows land in different CV folds, so the")
        print("  model is scored on data it trained on.\n")
        by_label = defaultdict(int)
        for record in within:
            by_label[record["samples"][0]["label"]] += 1
        for label, count in sorted(by_label.items(), key=lambda kv: -kv[1]):
            stats = result["per_class"][label]
            note = "  <-- every sample duplicated" if stats["unique"] * 2 <= stats["samples"] else ""
            print(f"  {label:20s} {count:3d} duplicated  "
                  f"(n={stats['samples']}, unique={stats['unique']}){note}")

    print("\n=== CLASSES NEEDING ATTENTION ===")
    flagged = [
        (lb, st) for lb, st in result["per_class"].items()
        if st["cross_labelled"] or st["duplicated"]
    ]
    if not flagged:
        print("  none")
    for label, st in sorted(flagged, key=lambda kv: (-kv[1]["cross_labelled"], kv[0])):
        bits = []
        if st["cross_labelled"]:
            bits.append(f"{st['cross_labelled']}/{st['samples']} rows share features with another class")
        if st["duplicated"]:
            bits.append(f"{st['duplicated']} duplicated")
        print(f"  {label:20s} {'; '.join(bits)}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", metavar="PATH", help="write the full findings as JSON")
    ap.add_argument("--cache", metavar="PATH",
                    help="read/write the fetched dataset here (the fetch is ~98 MB)")
    args = ap.parse_args()

    if args.cache and os.path.exists(args.cache):
        print(f"Reading cached dataset from {args.cache}")
        with open(args.cache) as fh:
            dataset = json.load(fh)
    else:
        dataset = fetch_approved_samples()
        if args.cache:
            with open(args.cache, "w") as fh:
                json.dump(dataset, fh)
            print(f"Cached dataset to {args.cache}")

    result = analyze(dataset)
    report(result)

    if args.json:
        with open(args.json, "w") as fh:
            json.dump(result, fh, indent=2)
        print(f"\nFull findings written to {args.json}")

    # Non-zero exit on cross-label collisions so CI can gate on them. Within-label
    # duplicates are a data-quality problem, not a correctness one, so they do not
    # fail the run on their own.
    return 1 if result["cross_label_collisions"] else 0


if __name__ == "__main__":
    sys.exit(main())
