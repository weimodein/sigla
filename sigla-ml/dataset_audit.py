"""
Dataset audit — count stored samples per class by frame width (126 vs 147).

The pose migration changed FEATURE_SIZE from 126 to 147. _preprocess_sample
silently drops any stored sample whose frames are not FEATURE_SIZE floats, so
every pre-migration (126-wide) sample would silently vanish from training.
Run this BEFORE any retrain to see exactly what would be dropped and which
videos need re-extraction.

Usage (from sigla-ml/, with the venv active and the backend reachable):
    python dataset_audit.py
"""
from collections import Counter

from app.utils.preprocessor import FEATURE_SIZE, fetch_approved_samples, list_signers


def main():
    dataset = fetch_approved_samples()
    signers = list_signers(dataset)
    print(f"Expected FEATURE_SIZE: {FEATURE_SIZE}")
    print(f"Distinct signers: {len(signers)} -> {signers}\n")

    total_ok, total_stale, total_bad = 0, 0, 0
    print(f"{'class':<20}{'total':>6}{'ok(' + str(FEATURE_SIZE) + ')':>10}{'stale':>7}{'empty/odd':>10}")
    for label in sorted(dataset.keys()):
        widths = Counter()
        for smp in dataset[label]:
            seq = smp.get("sequence") or []
            widths[len(seq[0]) if seq else 0] += 1
        ok    = widths.get(FEATURE_SIZE, 0)
        stale = sum(n for w, n in widths.items() if w not in (FEATURE_SIZE, 0))
        bad   = widths.get(0, 0)
        total_ok += ok; total_stale += stale; total_bad += bad
        flag = "" if stale == 0 and bad == 0 else "  <-- needs re-extract"
        stale_widths = {w: n for w, n in widths.items() if w not in (FEATURE_SIZE, 0)}
        detail = f" widths={stale_widths}" if stale_widths else ""
        print(f"{label:<20}{sum(widths.values()):>6}{ok:>10}{stale:>7}{bad:>10}{flag}{detail}")

    print(f"\n{'TOTAL':<20}{total_ok + total_stale + total_bad:>6}{total_ok:>10}{total_stale:>7}{total_bad:>10}")
    if total_stale or total_bad:
        print(f"\n{total_stale + total_bad} samples would be SILENTLY DROPPED at train time.")
        print("Re-extract those words' videos (gesture-samples bucket) through the "
              "extract endpoint before retraining.")
    else:
        print("\nAll samples match FEATURE_SIZE — safe to retrain.")


if __name__ == "__main__":
    main()
