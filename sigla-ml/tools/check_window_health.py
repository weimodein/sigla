"""
Re-extraction gate: verify stored samples were windowed with the CURRENT velocity signal.

WHY THIS EXISTS
---------------
extract.py picks the 30-frame window at UPLOAD time and the result is frozen in the
database -- center_on_peak_velocity() no-ops at train time because stored sequences
are already exactly SEQUENCE_LENGTH frames. So a fix to the velocity signal only
reaches data that is re-uploaded afterwards, and there is no way to tell from the
row itself which signal produced it.

This script infers it. It re-measures each stored window with the CURRENT
frame_velocity() and reports where the peak lands:

  Healthy  - the window was centred with this signal, so the peak sits near the
             middle (~frame 15) and few clips peak at the very start.
  Broken   - the window was centred with a DIFFERENT signal. The real motion then
             falls wherever it happens to fall, and in practice it clusters at
             frame <=2: the old hand-landmark signal measured finger articulation,
             so it centred on the static hold AFTER the discriminative arm motion,
             pushing the actual movement to the window's leading edge or out of it.

Measured on the pre-fix dataset, 60-95% of clips per word peaked at frame <=2 --
i.e. most training data did not contain the part of the gesture that identifies it.

USAGE
    # BEFORE re-uploading, save the baseline:
    venv/Scripts/python.exe tools/check_window_health.py > before.txt

    # AFTER re-uploading, confirm it changed:
    venv/Scripts/python.exe tools/check_window_health.py

Exit code is 1 on FAIL so this can gate a script. Requires the backend running
(same BACKEND_URL / ML_API_KEY as training).
"""

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.preprocessor import (  # noqa: E402
    FEATURE_SIZE,
    SEQUENCE_LENGTH,
    fetch_approved_samples,
    frame_velocity,
)

# A word fails if more than this share of its clips peak at EARLY_FRAME or before.
# Rationale: with a correctly centred window the peak is near SEQUENCE_LENGTH//2, so
# a large mass at the leading edge means some other signal chose the window. Some
# genuinely front-loaded clips are normal, hence a threshold rather than zero.
EARLY_FRAME = 2
FAIL_PCT = 30.0


def peak_frame(seq: np.ndarray) -> int:
    """Index of the highest-velocity transition under the CURRENT signal."""
    best_i, best_v = 0, 0.0
    for i in range(1, len(seq)):
        v = frame_velocity(seq[i - 1], seq[i])
        if v > best_v:
            best_v, best_i = v, i
    return best_i


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fail-pct", type=float, default=FAIL_PCT,
                    help=f"%% of clips peaking at frame<={EARLY_FRAME} that fails a word "
                         f"(default {FAIL_PCT})")
    args = ap.parse_args()

    dataset = fetch_approved_samples()

    print(f"Window health -- peak frame under the CURRENT velocity signal")
    print(f"(healthy: peak near {SEQUENCE_LENGTH // 2}; broken: mass at frame <= {EARLY_FRAME})")
    print()
    print(f"  {'word':<20} {'n':>4}  {'median':>6}  {'<=' + str(EARLY_FRAME):>6}")
    print(f"  {'-' * 20} {'-' * 4}  {'-' * 6}  {'-' * 6}")

    bad, total_clips, skipped = [], 0, 0

    for label in sorted(dataset):
        peaks = []
        for sample in dataset[label]:
            seq = sample.get("sequence")
            if not seq or len(seq[0]) != FEATURE_SIZE:
                skipped += 1
                continue
            peaks.append(peak_frame(np.array(seq, dtype=np.float32)))

        if not peaks:
            print(f"  {label:<20} {0:>4}  {'--':>6}  {'--':>6}   (no usable samples)")
            continue

        peaks = np.array(peaks)
        total_clips += len(peaks)
        early_pct = float((peaks <= EARLY_FRAME).mean() * 100)
        flag = "  <-- STILL BROKEN" if early_pct > args.fail_pct else ""
        if early_pct > args.fail_pct:
            bad.append(label)
        print(f"  {label:<20} {len(peaks):>4}  {int(np.median(peaks)):>6}  "
              f"{early_pct:>5.1f}%{flag}")

    print()
    if skipped:
        print(f"skipped {skipped} sample(s) with missing/wrong-width sequences")

    if bad:
        print(f"FAIL - {len(bad)} of {len(dataset)} word(s) still show the old windowing:")
        print(f"       {', '.join(bad)}")
        print()
        print("The extraction service did not use the current velocity signal.")
        print("Restart the ML service so it reloads preprocessor.py, then re-upload:")
        print("    uvicorn app.main:app --reload --port 8000 --host 0.0.0.0")
        print()
        print("Do NOT retrain until this passes - it would bake the bad windows into")
        print("the model, and the mobile app selects windows the new way.")
        return 1

    print(f"PASS - all {len(dataset)} word(s) look correctly windowed ({total_clips} clips).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
